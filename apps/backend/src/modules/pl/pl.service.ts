import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { GeocodingService } from '../geocoding/geocoding.service';

@Injectable()
export class PlService {
  private readonly logger = new Logger(PlService.name);

  constructor(
    private prisma: PrismaService,
    private geocodingService: GeocodingService,
  ) {}

  /**
   * Extrae la parte numérica principal del código
   * Ej:
   *  - "PL/5488/EXP/ES/2015" -> "5488"
   *  - "5488" -> "5488"
   * 
   * ⚠️ SOLO USAR PARA NEARBY para permitir búsquedas flexibles
   * NO USAR para getByCode() que debe buscar el código completo
   */
  private extractNumericPart(input: string): string {
    if (!input) return '';
    const digits = String(input).match(/\d+/);
    return digits ? digits[0] : '';
  }

  /**
   * GET /codes/pl/:code
   * 
   * 🔑 FUENTE DE VERDAD: Replica la lógica del buscador normal (CodesService.findByCode)
   * - Busca por código completo usando "contains" (flexible)
   * - Excluye registros con baja=true
   * - NO normaliza a solo números
   * - Maneja cualquier formato: "PL/5488/EXP/ES/2015" o "5488"
   */
  async getByCode(code: string) {
    if (!code || !code.trim()) {
      throw new NotFoundException('Invalid code format');
    }

    // Búsqueda flexible usando Prisma (igual que buscador normal)
    const pl = await this.prisma.code.findFirst({
      where: {
        AND: [
          { code: { contains: code.trim(), mode: 'insensitive' } },
          { OR: [{ baja: false }, { baja: null }] },
        ],
      },
      orderBy: { id: 'asc' },
    });

    if (!pl) {
      throw new NotFoundException(
        `PL ${code} not found or is marked as baja`
      );
    }

    // Helper opcional: intentar geocoding si faltan coordenadas
    const coords = await this.tryGeocodeIfNeeded(pl);

    return this.formatPlResponse({ ...pl, lat: coords.lat, lon: coords.lon });
  }

  /**
   * 🌍 HELPER OPCIONAL DE GEOCODIFICACIÓN
   * 
   * Intenta geocodificar un PL SOLO si no tiene lat/lon.
   * - No rompe el endpoint si falla (solo logea warning)
   * - Guarda coordenadas en DB automáticamente
   * - Usa caché para evitar llamadas duplicadas
   * - Retorna coords originales o nuevas coords geocodificadas
   * 
   * @param pl Registro del PL
   * @returns {lat, lon} Coordenadas (originales o geocodificadas)
   */
  private async tryGeocodeIfNeeded(pl: any): Promise<{ lat: number | null; lon: number | null }> {
    let lat = pl.lat;
    let lon = pl.lon;

    // Solo geocodificar si faltan coordenadas y hay dirección válida
    const hasValidAddress = pl.direccion && pl.direccion.trim().length > 0;
    if ((lat == null || lon == null) && hasValidAddress) {
      try {
        const geo = await this.geocodingService.geocode(pl.id);
        if (geo?.ok && geo.lat !== null && geo.lon !== null) {
          lat = geo.lat;
          lon = geo.lon;
          this.logger.log(`Geocoded PL ${pl.code}: ${lat}, ${lon}`);
        }
      } catch (err) {
        // Error no fatal: el endpoint sigue funcionando sin coords
        this.logger.warn(`Optional geocoding failed for PL ${pl.code}: ${err.message}`);
      }
    }

    return { lat, lon };
  }

  /**
   * GET /codes/pl/nearby?code=:code&radiusKm=5&limit=50
   * 
   * 🔑 Busca PLs cercanos usando Haversine
   * - Intenta extraer parte numérica para búsqueda flexible
   * - Si no hay parte numérica, usa el código completo
   * - Geocoding automático si falta coordenadas
   * - Excluye baja=true
   * - NUNCA devuelve 500 por datos incompletos
   */
  async findNearby(code: string, radiusKm: number = 5, limit: number = 50) {
    try {
      // Validar código
      if (!code || !code.trim()) {
        throw new NotFoundException('Invalid code format');
      }

      // Validar y sanitizar radiusKm y limit
      const validRadius = this.validateRadius(radiusKm);
      const validLimit = this.validateLimit(limit);

      // Para nearby, intentamos búsqueda flexible con parte numérica
      // Si no hay números, usamos el código completo
      const numericPart = this.extractNumericPart(code);
      const searchTerm = numericPart || code.trim();
      
      const basePl = await this.prisma.code.findFirst({
        where: {
          AND: [
            { code: { contains: searchTerm, mode: 'insensitive' } },
            { OR: [{ baja: false }, { baja: null }] },
          ],
        },
        orderBy: { id: 'asc' },
      });

      if (!basePl) {
        throw new NotFoundException(
          `PL ${code} not found or is marked as baja`
        );
      }

      // Helper opcional: intentar geocoding si faltan coordenadas
      const baseCoords = await this.tryGeocodeIfNeeded(basePl);
      const baseLat = baseCoords.lat;
      const baseLon = baseCoords.lon;

      // ⚠️ REQUISITO 1: Si no hay coordenadas, devolver 200 con nearby vacío
      // NO lanzar error 422, simplemente indicar que no se pueden calcular cercanos
      if (baseLat == null || baseLon == null) {
        this.logger.warn(
          `PL ${code} has no coordinates. Returning empty nearby list.`
        );
        return {
          base: this.formatPlResponse(basePl),
          radiusKm: validRadius,
          count: 0,
          nearby: [],
          bajasMunicipio: [],
          message: 'Base PL has no coordinates. Cannot calculate nearby PLs.',
        };
      }

      // Traer candidatos cercanos (sin SQL crudo)
      const candidates = await this.prisma.code.findMany({
        where: {
          AND: [
            { id: { not: basePl.id } },
            { OR: [{ baja: false }, { baja: null }] },
            { lat: { not: null } },
            { lon: { not: null } },
          ],
        },
        select: {
          id: true,
          code: true,
          razon_social: true,
          estado: true,
          municipio: true,
          direccion: true,
          lat: true,
          lon: true,
          grupo_id: true,
          encargado_actual: true,
          baja: true,
          m13: true,
          calibracion: true,
          created_at: true,
          updated_at: true,
        },
      });

      // Haversine en JS con validación defensiva
      const toRad = (v: number) => (v * Math.PI) / 180;
      const haversineKm = (lat: number, lon: number) => {
        // ⚠️ DEFENSIVE: Asegurar que las coordenadas son números finitos válidos
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          return Infinity; // Excluir este punto de los resultados
        }

        const R = 6371; // Radio de la Tierra en km
        const dLat = toRad(lat - baseLat!);
        const dLon = toRad(lon - baseLon!);
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(baseLat!)) *
            Math.cos(toRad(lat)) *
            Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };

      const nearby = candidates
        .map((pl) => ({
          ...pl,
          distanceKm: Number(haversineKm(pl.lat!, pl.lon!).toFixed(2)),
        }))
        .filter((pl) => pl.distanceKm <= validRadius && Number.isFinite(pl.distanceKm))
        .sort((a, b) => a.distanceKm - b.distanceKm);

      // Aplicar limit SOLO al array nearby, NO al count
      const limitedNearby = nearby.slice(0, validLimit);

      // ⚠️ DEFENSIVE: Si falla nearby, no fallar todo el endpoint
      // El PL base sigue siendo válido y útil
      
      // Buscar BAJAs del mismo municipio (sin filtro de distancia)
      let bajasMunicipio = [];
      try {
        // Solo buscar si el PL base tiene municipio y estado definidos
        if (basePl.municipio && basePl.estado) {
          const bajas = await this.prisma.code.findMany({
            where: {
              AND: [
                { id: { not: basePl.id } }, // Excluir el PL base
                { baja: true }, // Solo BAJAs
                { municipio: basePl.municipio }, // Mismo municipio
                { estado: basePl.estado }, // Mismo estado
                { lat: { not: null } }, // Coordenadas requeridas
                { lon: { not: null } },
              ],
            },
            select: {
              id: true,
              code: true,
              razon_social: true,
              estado: true,
              municipio: true,
              direccion: true,
              lat: true,
              lon: true,
              baja: true,
              grupo_id: true,
              encargado_actual: true,
            },
            orderBy: [
              { razon_social: 'asc' }, // Ordenar por nombre (más útil para usuarios)
              { id: 'asc' }, // Desempate por id
            ],
            take: 50, // Límite de 50 registros
          });
          
          bajasMunicipio = bajas.map((pl) => this.formatPlResponse(pl));
        }
      } catch (error) {
        // Si falla la búsqueda de BAJAs, loguear pero no romper el endpoint
        this.logger.warn(
          `Error fetching bajasMunicipio for ${code}: ${error.message}`
        );
        bajasMunicipio = [];
      }
      
      return {
        base: this.formatPlResponse({ ...basePl, lat: baseLat, lon: baseLon }),
        radiusKm: validRadius,
        count: nearby.length,
        nearby: limitedNearby.map((pl) => ({
          ...this.formatPlResponse(pl),
          distanceKm: pl.distanceKm,
        })),
        bajasMunicipio,
      };
    } catch (error) {
      // ⚠️ REQUISITO 5: Loguear el error real para debugging
      this.logger.error(
        `Error in findNearby for code=${code}, radiusKm=${radiusKm}: ${error.message}`,
        error.stack,
      );

      // Re-lanzar errores conocidos (NotFoundException)
      if (error instanceof NotFoundException) {
        throw error;
      }

      // Para cualquier otro error inesperado, loguear y re-lanzar
      // El framework de NestJS manejará esto apropiadamente
      throw error;
    }
  }

  /**
   * Valida y sanitiza el parámetro radiusKm
   * REQUISITO 3: Validar radiusKm con default 5
   */
  private validateRadius(radiusKm: any): number {
    // Default: 5 km
    if (radiusKm === undefined || radiusKm === null || radiusKm === '') {
      return 5;
    }

    const parsed = Number(radiusKm);

    // Si no es un número válido, usar default
    if (!Number.isFinite(parsed)) {
      this.logger.warn(`Invalid radiusKm value: ${radiusKm}, using default 5`);
      return 5;
    }

    // Si es negativo, usar valor absoluto
    if (parsed < 0) {
      this.logger.warn(`Negative radiusKm value: ${parsed}, using absolute value`);
      return Math.abs(parsed);
    }

    // Limitar a un máximo razonable (ej. 1000 km)
    if (parsed > 1000) {
      this.logger.warn(`RadiusKm too large: ${parsed}, capping at 1000`);
      return 1000;
    }

    return parsed;
  }

  /**
   * Valida y sanitiza el parámetro limit
   * Default: 50, Min: 10, Max: 500
   */
  private validateLimit(limit: any): number {
    // Default: 50
    if (limit === undefined || limit === null || limit === '') {
      return 50;
    }

    const parsed = Number(limit);

    // Si no es un número válido, usar default
    if (!Number.isFinite(parsed)) {
      this.logger.warn(`Invalid limit value: ${limit}, using default 50`);
      return 50;
    }

    // Aplicar límites min/max
    if (parsed < 10) {
      this.logger.warn(`Limit too small: ${parsed}, using minimum 10`);
      return 10;
    }

    if (parsed > 500) {
      this.logger.warn(`Limit too large: ${parsed}, using maximum 500`);
      return 500;
    }

    return Math.round(parsed); // Redondear al entero más cercano
  }

  /**
   * Formato consistente de salida
   * Incluye todos los campos que el frontend puede necesitar
   */
  private formatPlResponse(pl: any) {
    return {
      id: Number(pl.id),
      code: pl.code,
      razon_social: pl.razon_social ?? null,
      estado: pl.estado ?? null,
      municipio: pl.municipio ?? null,
      direccion: pl.direccion ?? null,
      lat: pl.lat ?? null,
      lon: pl.lon ?? null,
      grupo_id: pl.grupo_id ?? null,
      encargado_actual: pl.encargado_actual ?? null,
      baja: pl.baja ?? null,
      m13: pl.m13 ?? null,
      calibracion: pl.calibracion ?? null,
      created_at: pl.created_at ?? null,
      updated_at: pl.updated_at ?? null,
    };
  }

  /**
   * GET /codes/pl/geocode-debug?code=:code
   * 
   * 🔍 DEBUG ENDPOINT - Temporal para diagnóstico
   * Encuentra el PL base y prueba geocoding devolviendo detalles completos
   * NUNCA devuelve 500 - siempre 200 con información de error si falla
   */
  async geocodeDebug(code: string) {
    try {
      // 1) Encontrar el PL base igual que /codes/pl/nearby lo hace
      if (!code || !code.trim()) {
        return {
          usedProvider: 'none',
          errorMessage: 'Invalid code format',
          envKeyPresent: Boolean(process.env.GEOCODING_API_KEY),
        };
      }

      // Búsqueda flexible con parte numérica (igual que nearby)
      const numericPart = this.extractNumericPart(code);
      const searchTerm = numericPart || code.trim();
      
      const basePl = await this.prisma.code.findFirst({
        where: {
          AND: [
            { code: { contains: searchTerm, mode: 'insensitive' } },
            { OR: [{ baja: false }, { baja: null }] },
          ],
        },
        orderBy: { id: 'asc' },
      });

      if (!basePl) {
        return {
          usedProvider: 'none',
          errorMessage: `PL ${code} not found or is marked as baja`,
          envKeyPresent: Boolean(process.env.GEOCODING_API_KEY),
        };
      }

      // 2) Verificar que tenga los datos necesarios para construir dirección
      if (!basePl.direccion || !basePl.municipio || !basePl.estado) {
        return {
          usedProvider: 'none',
          errorMessage: 'PL found but missing address components (direccion, municipio, or estado)',
          plCode: basePl.code,
          envKeyPresent: Boolean(process.env.GEOCODING_API_KEY),
        };
      }

      // 3) Intentar geocoding con la MISMA lógica que usa nearby
      const debugResult = await this.geocodingService.geocodeDebug(basePl);
      
      // Añadir información del PL encontrado
      debugResult.plCode = basePl.code;
      debugResult.plId = Number(basePl.id);
      
      return debugResult;
      
    } catch (error) {
      // NUNCA devolver 500 - capturar cualquier error y devolver 200
      this.logger.error(`geocodeDebug error: ${error.message}`, error.stack);
      return {
        usedProvider: 'none',
        errorMessage: `Unexpected error: ${error.message}`,
        envKeyPresent: Boolean(process.env.GEOCODING_API_KEY),
      };
    }
  }
}
