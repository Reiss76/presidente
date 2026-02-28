import { Controller, Get, Param, Query } from '@nestjs/common';
import { PlService } from './pl.service';

// 🔑 IMPORTANTE: Ruta correcta según documentación y para no romper otros endpoints
@Controller('codes/pl')
export class PlController {
  constructor(private readonly plService: PlService) {}

  /**
   * PRUEBA DE VIDA
   * GET /pl/ping
   * Esto nos confirma que el controller está montado y respondiendo.
   */
  @Get('ping')
  ping() {
    return { ok: true, ts: Date.now() };
  }

  /**
   * GET /pl/nearby?code=:code&radiusKm=5&limit=50
   * Find nearby PLs within a radius
   * ⚠️ IMPORTANTE: debe ir ANTES de ':code'
   */
  @Get('nearby')
  async findNearby(
    @Query('code') code: string,
    @Query('radiusKm') radiusKm?: string,
    @Query('limit') limit?: string,
  ) {
    const radius = radiusKm ? Number(radiusKm) : 5;
    const parsedLimit = limit ? Number(limit) : 50;
    return this.plService.findNearby(code, radius, parsedLimit);
  }

  /**
   * GET /pl/geocode-debug?code=:code
   * 🔍 DEBUG ENDPOINT - Temporal para diagnóstico de geocoding
   * Prueba el geocoding de un PL y devuelve información detallada
   * SIEMPRE devuelve 200 (nunca 500)
   */
  @Get('geocode-debug')
  async geocodeDebug(@Query('code') code: string) {
    return this.plService.geocodeDebug(code);
  }

  /**
   * GET /pl/:code
   * Get a PL by code
   * Acepta:
   * - "PL/12345/EXP/..."
   * - "12345"
   */
  @Get(':code')
  async getByCode(@Param('code') code: string) {
    return this.plService.getByCode(code);
  }
}
