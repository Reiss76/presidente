import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import * as crypto from 'crypto';

export interface GeocodeDebugResult {
  usedProvider: 'nominatim' | 'google' | 'none';
  requestAddress: string;
  envKeyPresent: boolean;
  resultLatLon: { lat: number; lon: number } | null;
  formatted_address?: string;
  place_id?: string;
  googleStatus?: string;
  errorMessage?: string;
  nominatimError?: string;
  httpStatus?: string | number;
  plCode?: string;
  plId?: number;
}

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private lastNominatimCall = 0;
  private readonly NOMINATIM_RATE_LIMIT_MS = 1000; // 1 second between calls

  constructor(private prisma: PrismaService) {}

  private addressStr(code: any) {
    return `${code.direccion}, ${code.municipio}, ${code.estado}, México`;
  }

  private hash(str: string) {
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  async geocode(codeId: bigint) {
    const code = await this.prisma.code.findUnique({ where: { id: codeId } });
    if (!code) return { ok: false, error: 'not_found' };
    
    const address_str = this.addressStr(code);
    const address_hash = this.hash(address_str);
    
    // Check cache first
    const cached = await this.prisma.geocodeCache.findUnique({ where: { address_hash } });
    if (cached?.status === 'OK' && cached.lat && cached.lon) {
      // Note: 'comentario' field in DB is actually 'place_id' column (see schema comment)
      // This is a legacy mapping that reuses the column for storing place_id
      await this.prisma.code.update({ 
        where: { id: codeId }, 
        data: { 
          lat: cached.lat, 
          lon: cached.lon, 
          comentario: cached.place_id || null, 
          formatted_address: cached.formatted_address || null 
        } 
      });
      return { ok: true, cached: true, lat: cached.lat, lon: cached.lon };
    }

    // Try Nominatim first (free, no API key required)
    try {
      const nominatimResult = await this.geocodeWithNominatim(address_str);
      if (nominatimResult.ok) {
        await this.prisma.$transaction([
          this.prisma.geocodeCache.upsert({
            where: { address_hash },
            create: { 
              address_hash, 
              address_str, 
              lat: nominatimResult.lat, 
              lon: nominatimResult.lon, 
              formatted_address: nominatimResult.formatted_address,
              status: 'OK',
              provider: 'nominatim'
            },
            update: { 
              lat: nominatimResult.lat, 
              lon: nominatimResult.lon, 
              formatted_address: nominatimResult.formatted_address,
              status: 'OK',
              provider: 'nominatim',
              refreshed_at: new Date() 
            }
          }),
          this.prisma.code.update({ 
            where: { id: codeId }, 
            data: { 
              lat: nominatimResult.lat, 
              lon: nominatimResult.lon,
              formatted_address: nominatimResult.formatted_address
            } 
          })
        ]);
        return { ok: true, cached: false, lat: nominatimResult.lat, lon: nominatimResult.lon, provider: 'nominatim' };
      }
    } catch (error) {
      this.logger.warn(`Nominatim geocoding failed: ${error.message}`);
    }

    // Fallback to Google Maps if available
    const key = process.env.GEOCODING_API_KEY;
    if (key) {
      try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address_str)}&components=country:MX&region=mx&language=es&key=${key}`;
        const resp = await fetch(url);
        const json: any = await resp.json();
        const status = json.status;
        
        if (status === 'OK' && json.results?.length) {
          const r = json.results[0];
          const lat = r.geometry.location.lat;
          const lon = r.geometry.location.lng;
          const place_id = r.place_id;
          const formatted_address = r.formatted_address;
          
          await this.prisma.$transaction([
            this.prisma.geocodeCache.upsert({
              where: { address_hash },
              create: { address_hash, address_str, lat, lon, place_id, formatted_address, status: 'OK', provider: 'google' },
              update: { lat, lon, place_id, formatted_address, status: 'OK', provider: 'google', refreshed_at: new Date() }
            }),
            // Note: 'comentario' field maps to 'place_id' column in DB (see schema)
            this.prisma.code.update({ where: { id: codeId }, data: { lat, lon, comentario: place_id, formatted_address } })
          ]);
          return { ok: true, cached: false, lat, lon, provider: 'google' };
        } else {
          await this.prisma.geocodeCache.upsert({
            where: { address_hash },
            create: { address_hash, address_str, status, provider: 'google' },
            update: { status, provider: 'google', refreshed_at: new Date() }
          });
          return { ok: false, status };
        }
      } catch (error) {
        this.logger.warn(`Google Maps geocoding failed: ${error.message}`);
      }
    }

    // No provider available - try to cache this result
    try {
      await this.prisma.geocodeCache.upsert({
        where: { address_hash },
        create: { address_hash, address_str, status: 'NO_PROVIDER' },
        update: { status: 'NO_PROVIDER', refreshed_at: new Date() }
      });
    } catch (error) {
      // Cache update failed, but geocoding already failed, so just log
      this.logger.warn(`Failed to cache NO_PROVIDER status: ${error.message}`);
    }
    return { ok: false, error: 'no_provider' };
  }

  private async geocodeWithNominatim(address: string): Promise<{ ok: boolean; lat?: number; lon?: number; formatted_address?: string; error?: string }> {
    // Rate limiting
    const now = Date.now();
    const timeSinceLastCall = now - this.lastNominatimCall;
    if (timeSinceLastCall < this.NOMINATIM_RATE_LIMIT_MS) {
      await new Promise(resolve => setTimeout(resolve, this.NOMINATIM_RATE_LIMIT_MS - timeSinceLastCall));
    }
    this.lastNominatimCall = Date.now();

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=mx`;
    
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'CodesBackend/1.0 (contact: admin@example.com)' // Required by Nominatim
      }
    });

    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}` };
    }

    const results: any[] = await resp.json();
    
    if (results && results.length > 0) {
      const result = results[0];
      return {
        ok: true,
        lat: parseFloat(result.lat),
        lon: parseFloat(result.lon),
        formatted_address: result.display_name
      };
    }

    return { ok: false, error: 'not_found' };
  }

  async geocodeByCode(code: string): Promise<{ ok: boolean; lat?: number; lon?: number; error?: string }> {
    const record = await this.prisma.code.findUnique({ where: { code } });
    if (!record) return { ok: false, error: 'not_found' };
    
    // If already has coordinates, return them
    if (record.lat && record.lon) {
      return { ok: true, lat: record.lat, lon: record.lon };
    }

    // Try to geocode
    const result = await this.geocode(record.id);
    if (result.ok && result.lat && result.lon) {
      return { ok: true, lat: result.lat, lon: result.lon };
    }

    return { ok: false, error: result.error || 'geocoding_failed' };
  }

  /**
   * Debug method that returns detailed geocoding information
   * Used by the /codes/pl/geocode-debug endpoint
   */
  async geocodeDebug(codeRecord: any): Promise<GeocodeDebugResult> {
    const address_str = this.addressStr(codeRecord);
    const hasApiKey = Boolean(process.env.GEOCODING_API_KEY);
    
    let result: GeocodeDebugResult = {
      usedProvider: 'none',
      requestAddress: address_str,
      envKeyPresent: hasApiKey,
      resultLatLon: null,
    };

    // Try Nominatim first
    try {
      const nominatimResult = await this.geocodeWithNominatim(address_str);
      if (nominatimResult.ok && nominatimResult.lat && nominatimResult.lon) {
        result.usedProvider = 'nominatim';
        result.resultLatLon = { lat: nominatimResult.lat, lon: nominatimResult.lon };
        result.formatted_address = nominatimResult.formatted_address;
        return result;
      } else {
        result.nominatimError = nominatimResult.error || 'not_found';
      }
    } catch (error) {
      result.nominatimError = error.message;
      result.httpStatus = error.status || 'unknown';
    }

    // Try Google Maps as fallback if API key is available
    if (hasApiKey) {
      try {
        const key = process.env.GEOCODING_API_KEY;
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address_str)}&components=country:MX&region=mx&language=es&key=${key}`;
        const resp = await fetch(url);
        const json: any = await resp.json();
        
        result.googleStatus = json.status;
        
        if (json.status === 'OK' && json.results?.length) {
          const r = json.results[0];
          result.usedProvider = 'google';
          result.resultLatLon = {
            lat: r.geometry.location.lat,
            lon: r.geometry.location.lng
          };
          result.formatted_address = r.formatted_address;
          result.place_id = r.place_id;
          return result;
        } else {
          result.errorMessage = `Google geocoding returned status: ${json.status}`;
        }
      } catch (error) {
        result.errorMessage = error.message;
        result.httpStatus = error.status || 'unknown';
      }
    }

    // No provider succeeded
    if (!result.errorMessage && !result.nominatimError) {
      result.errorMessage = 'No provider available or all providers failed';
    }
    
    return result;
  }
}
