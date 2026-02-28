import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { CodesService, Actor } from './codes.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const vision = require('@google-cloud/vision');

const CODE_REGEX = /PL\/\d{1,10}(?:\/[A-Z0-9]+)*/g;

type ResearchSource = { title: string; url: string };
type ResearchResult = {
  ok: boolean;
  code: string;
  internal: unknown;
  summary: string;
  sources: ResearchSource[];
  webEnabled: boolean;
  note?: string;
};

@Controller('codes')
export class CodesController {
  constructor(private readonly codesService: CodesService) {}

  // Helper robusto para booleans en query: 1/0, true/false, yes/no, on/off
  private parseBool(v?: string): boolean {
    if (!v) return false;
    const s = String(v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
  }

  private parsePositiveFloat(v?: string, def = 5): number {
    if (v === undefined || v === null || v === '') return def;
    const n = parseFloat(String(v));
    if (!Number.isFinite(n) || n <= 0) return def;
    return n;
  }

  private parseIntClamped(v: string | undefined, def: number, min: number, max: number): number {
    if (v === undefined || v === null || v === '') return def;
    const n = parseInt(String(v), 10);
    if (!Number.isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
  }

  // ==============================
  // NEARBY CODES (geolocation)
  // ==============================
  @Get('pl/nearby')
  async findNearby(
    @Query('code') code?: string,
    @Query('radiusKm') radiusKm?: string,
    @Query('includeBajas') includeBajas?: string,
    @Query('bajasMunicipio') bajasMunicipio?: string,
    @Query('bajasEstado') bajasEstado?: string,
    @Query('bajasRadioKm') bajasRadioKm?: string,
    @Query('bajasLimit') bajasLimit?: string,
  ) {
    if (!code || !code.trim()) {
      throw new BadRequestException('Query parameter "code" is required');
    }

    const radius = this.parsePositiveFloat(radiusKm, 5);

    const includeBajasBool = this.parseBool(includeBajas);
    const bajasMunicipioBool = this.parseBool(bajasMunicipio);
    const bajasEstadoBool = this.parseBool(bajasEstado);
    // Only set bajasRadioKm if the parameter was explicitly provided
    const bajasRadioKmNum = bajasRadioKm !== undefined && bajasRadioKm !== null && bajasRadioKm !== '' 
      ? this.parseIntClamped(bajasRadioKm, 200, 1, 500)
      : undefined;
    const bajasLimitNum = this.parseIntClamped(bajasLimit, 200, 1, 500);

    return this.codesService.findNearby(
      code.trim(),
      radius,
      {
        includeBajas: includeBajasBool,
        bajasMunicipio: bajasMunicipioBool,
        bajasEstado: bajasEstadoBool,
        bajasRadioKm: bajasRadioKmNum,
        bajasLimit: bajasLimitNum,
      },
    );
  }

  // ==============================
  // ASIGNACIONES (filtros)
  // ==============================
  @Get('assigned')
  async assigned(
    @Query('encargado') encargado?: string,
    @Query('grupo_id') grupo_id?: string,
    @Query('estado') estado?: string,
    @Query('municipio') municipio?: string,
    @Query('include_baja') include_baja?: string,
  ) {
    return this.codesService.assigned({
      encargado,
      grupo_id: grupo_id ? Number(grupo_id) : undefined,
      estado,
      municipio,
      include_baja: this.parseBool(include_baja),
    });
  }

  // ==============================
  // CATÁLOGOS DEPENDIENTES (Estado / Municipio)
  // ==============================
  @Get('tools/states')
  async states() {
    try {
      return await this.codesService.listStates();
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Error al obtener estados', where: 'codes/tools/states', details: error?.stack || String(error) };
    }
  }

  @Get('tools/municipalities')
  async municipalities(@Query('estado') estado?: string) {
    try {
      return await this.codesService.listMunicipalities(estado || '');
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Error al obtener municipios', where: 'codes/tools/municipalities', details: error?.stack || String(error) };
    }
  }

  // ==============================
  // BATCH GEOCODING
  // ==============================

  // Batch geocode codes with missing lat/lon
  @Get('tools/geocode-missing')
  async geocodeMissingGet(
    @Query('limit') limit?: string,
    @Query('startId') startId?: string,
    @Query('includeBajas') includeBajas?: string,
  ) {
    return this.geocodeMissingHandler(limit, startId, includeBajas);
  }

  @Post('tools/geocode-missing')
  async geocodeMissingPost(
    @Query('limit') limit?: string,
    @Query('startId') startId?: string,
    @Query('includeBajas') includeBajas?: string,
  ) {
    return this.geocodeMissingHandler(limit, startId, includeBajas);
  }

  private async geocodeMissingHandler(
    limit?: string,
    startId?: string,
    includeBajas?: string,
  ) {
    try {
      const envKeyPresent = Boolean(process.env.GEOCODING_API_KEY);

      if (!envKeyPresent) {
        return {
          ok: false,
          error: 'GEOCODING_API_KEY environment variable is missing or empty',
          where: 'validation',
          details: 'The Google Geocoding API key must be configured to use this endpoint',
          envKeyPresent: false,
        };
      }

      // Validate and parse limit (default 10, max 1000)
      const limitNum = this.parseIntClamped(limit, 10, 1, 1000);

      // Parse startId (BigInt) safely
      let startIdNum = BigInt(0);
      if (startId && String(startId).trim() !== '') {
        try {
          startIdNum = BigInt(String(startId));
        } catch {
          return {
            ok: false,
            error: 'startId inválido, debe ser numérico',
            where: 'validation',
            details: `Received startId: ${startId}`,
            envKeyPresent,
          };
        }
      }

      const includeBajasBool = this.parseBool(includeBajas);

      // ✅ Llamada tolerante (evita TS mismatch). Si el service no acepta 3er arg aún,
      // no truena porque usamos "as any". Si lo acepta, perfecto.
      const result = await (this.codesService as any).geocodeMissing(
        limitNum,
        startIdNum,
        includeBajasBool,
      );

      const sampleFailed = Array.isArray(result?.sampleFailed) ? result.sampleFailed : [];
      const reasonsSample = sampleFailed.map((item: any) => ({
        code: item.code,
        reason: item.reason || 'unknown',
        error: item.error,
        address: item.address,
      }));

      return {
        ok: true,
        processed: Number(result?.processed ?? 0),
        updated: Number(result?.updated ?? 0),
        failed: Number(result?.failed ?? 0),
        retried: Number(result?.retried ?? 0),
        overLimitCount: Number(result?.overLimitCount ?? 0),
        lastIdProcessed: result?.lastIdProcessed ?? null,
        elapsedMs: Number(result?.elapsedMs ?? 0),
        reasonsSample,
        envKeyPresent,
        includeBajas: includeBajasBool,
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error?.message || 'An unexpected error occurred',
        where: 'execution',
        details: error?.stack || String(error),
        envKeyPresent: Boolean(process.env.GEOCODING_API_KEY),
      };
    }
  }

  // Retry geocode for codes with valid municipio and estado but missing lat/lon
  @Get('tools/geocode-retry')
  async geocodeRetry(
    @Query('limit') limit?: string,
    @Query('includeBajas') includeBajas?: string,
  ) {
    try {
      const limitNum = this.parseIntClamped(limit, 500, 1, 1000);
      const includeBajasBool = this.parseBool(includeBajas);

      const result = await (this.codesService as any).geocodeRetry(limitNum, includeBajasBool);
      return result;
    } catch (error: any) {
      return {
        ok: false,
        error: error?.message || 'An unexpected error occurred',
        processed: 0,
        updated: 0,
        failed: 0,
        sampleUpdated: [],
        sampleFailed: [],
      };
    }
  }

  // ==============================
  // DASHBOARD
  // ==============================

  // Test URLs:
  //   GET /codes/tools/dashboard/catalogs
  //   GET /codes/tools/dashboard/filters
  //   GET /codes/tools/dashboard/results?limit=10
  //   GET /codes/tools/dashboard/export.csv?limit=100

  @Get('tools/dashboard/catalogs')
  async dashboardCatalogs() {
    try {
      return await this.codesService.dashboardCatalogs();
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Error al obtener catálogos', where: 'codes/tools/dashboard/catalogs', details: error?.stack || String(error) };
    }
  }

  @Get('tools/dashboard/filters')
  async dashboardFilters() {
    try {
      return await this.codesService.dashboardFilters();
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Error al obtener filtros', where: 'codes/tools/dashboard/filters', details: error?.stack || String(error) };
    }
  }

  @Get('tools/dashboard/results')
  async dashboardResults(
    @Query() query: Record<string, string>,
  ) {
    try {
      return await this.codesService.dashboardResults(query);
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Error al obtener resultados', where: 'codes/tools/dashboard/results' };
    }
  }

  @Get('tools/dashboard/export.csv')
  async dashboardExportCsv(
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      const csv = await this.codesService.dashboardExportCsv(query);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="dashboard-export.csv"');
      res.send(csv);
    } catch (error: any) {
      res.json({ ok: false, error: error?.message || 'Error exportando CSV', where: 'codes/tools/dashboard/export.csv' });
    }
  }

  // ==============================
  // COMPATIBILIDAD: catálogos por rutas alternativas
  // ==============================

  @Get('assigned/catalogs')
  async assignedCatalogs() {
    try {
      return await this.codesService.dashboardCatalogs();
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Error al obtener catálogos', where: 'codes/assigned/catalogs' };
    }
  }

  @Get('catalogs')
  async catalogs() {
    try {
      return await this.codesService.dashboardCatalogs();
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Error al obtener catálogos', where: 'codes/catalogs' };
    }
  }

  // ==============================
  // ACTUALIZACIÓN MASIVA (bulk-update)
  // ==============================
  @Patch('bulk-update')
  async bulkUpdate(
    @Body()
    body: {
      ids?: number[];
      encargado_actual?: string | null;
      grupo_id?: number | null;
      encargado_anterior?: string | null;
      comentario?: string | null;
      calibracion?: string | null;
      m13?: boolean | null;
      actor?: Actor;
      force_user_change?: boolean;
      auth_password?: string;
    },
  ) {
    try {
      const { ids, actor, force_user_change, auth_password, ...data } = body;

      if (!Array.isArray(ids) || ids.length === 0) {
        throw new BadRequestException('ids debe ser un array no vacío de números');
      }

      // Validate every id is a finite number
      const safeIds: number[] = [];
      for (const raw of ids) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) {
          throw new BadRequestException(`id inválido: ${String(raw)}`);
        }
        safeIds.push(n);
      }

      return await this.codesService.bulkUpdate(
        safeIds,
        data,
        actor,
        force_user_change,
        auth_password,
      );
    } catch (error: any) {
      // Re-throw NestJS HTTP exceptions as-is
      if (error instanceof HttpException) throw error;
      // Wrap unexpected errors in a clear response
      throw new InternalServerErrorException({
        ok: false,
        error: error?.message || 'Error inesperado en bulk-update',
        where: 'bulkUpdate',
        details: String(error?.message || error),
      });
    }
  }

  // =========================
  // OCR
  // =========================
  @Post('image-search')
  @UseInterceptors(FileInterceptor('file'))
  async searchFromImage(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No se recibió archivo');

    const raw = process.env.GOOGLE_VISION_CREDENTIALS_JSON;
    if (!raw) {
      throw new InternalServerErrorException(
        'Falta configurar GOOGLE_VISION_CREDENTIALS_JSON en Railway.',
      );
    }

    const credentials = JSON.parse(raw);
    const client = new vision.ImageAnnotatorClient({
      credentials,
      projectId: credentials.project_id,
    });

    try {
      const [result] = await client.textDetection(file.buffer);
      const text: string = result.fullTextAnnotation?.text || '';

      const lines = text.split(/\r?\n/);
      const rawCodes: string[] = [];
      const seen = new Set<string>();

      for (const line of lines) {
        const trimmed = line.trim();

        const pls = trimmed.match(CODE_REGEX) ?? [];
        for (const m of pls) {
          if (!seen.has(m)) {
            seen.add(m);
            rawCodes.push(m);
          }
        }

        if (/^\d{3,10}$/.test(trimmed)) {
          if (!seen.has(trimmed)) {
            seen.add(trimmed);
            rawCodes.push(trimmed);
          }
        }
      }

      if (!rawCodes.length) return { text, codes: [], results: [] };

      const results = await this.codesService.bulkLookup(rawCodes);
      return { text, codes: rawCodes, results };
    } catch (err) {
      console.error('Error OCR:', err);
      throw new InternalServerErrorException(
        'No se pudo procesar la imagen. Intenta otra vez con más luz.',
      );
    }
  }

  // =========================
  // INVESTIGACIÓN IA (PL)
  // =========================
  @Post('tools/research')
  async research(@Body('code') inputCode?: string): Promise<ResearchResult> {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      throw new BadRequestException('OPENAI_API_KEY no está configurada en backend.');
    }

    const cleanInput = String(inputCode || '').trim();
    if (!cleanInput) {
      throw new BadRequestException('El campo "code" es obligatorio.');
    }

    const core = (() => {
      const m = cleanInput.toUpperCase().match(/PL\/(\d+)\//);
      if (m?.[1]) return m[1];
      const d = cleanInput.match(/\d+/);
      return d?.[0] || cleanInput;
    })();

    const internal = await this.codesService.findByCode(core);
    if (!internal) {
      throw new NotFoundException(`No existe PL/código en base interna: ${core}`);
    }

    const model = process.env.OPENAI_RESEARCH_MODEL || 'gpt-4.1-mini';
    const prompt = [
      'Eres analista operativo de códigos PL en México.',
      `Código/PL a investigar: ${core}`,
      'Datos internos confiables (JSON):',
      JSON.stringify(internal),
      'Tarea:',
      '1) Genera un resumen ejecutivo útil para operación.',
      '2) Incluye riesgos, contexto, y recomendaciones accionables.',
      '3) Si usas web, prioriza fuentes oficiales y confiables.',
      '4) Responde SIEMPRE en JSON con forma: { summary: string, sources: [{title,url}] }',
    ].join('\n');

    const runOpenAI = async (withWeb: boolean) => {
      const body: any = {
        model,
        input: prompt,
      };
      if (withWeb) body.tools = [{ type: 'web_search_preview' }];

      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`OpenAI ${res.status}: ${txt.slice(0, 400)}`);
      }

      const data: any = await res.json();
      const text = String(data?.output_text || '').trim();
      return { text, data };
    };

    try {
      const primary = await runOpenAI(true);
      let parsed: any = {};
      try {
        parsed = JSON.parse(primary.text);
      } catch {
        parsed = { summary: primary.text, sources: [] };
      }

      return {
        ok: true,
        code: core,
        internal,
        summary: String(parsed?.summary || primary.text || '').trim(),
        sources: Array.isArray(parsed?.sources) ? parsed.sources : [],
        webEnabled: true,
      };
    } catch (webErr: any) {
      const fallback = await runOpenAI(false);
      let parsed: any = {};
      try {
        parsed = JSON.parse(fallback.text);
      } catch {
        parsed = { summary: fallback.text, sources: [] };
      }

      return {
        ok: true,
        code: core,
        internal,
        summary: String(parsed?.summary || fallback.text || '').trim(),
        sources: Array.isArray(parsed?.sources) ? parsed.sources : [],
        webEnabled: false,
        note: `No se pudo activar web_search en OpenAI: ${webErr?.message || 'unknown error'}`,
      };
    }
  }

  // =========================
  // CREAR + BÚSQUEDAS
  // =========================
  @Post()
  async create(
    @Body()
    body: {
      code: string;
      razon_social: string;
      estado: string;
      municipio: string;
      direccion: string;
    },
  ) {
    return this.codesService.createCode(body);
  }

  @Get()
  async findAll(@Query('query') query?: string) {
    return this.codesService.search(query);
  }

  @Get('by-code')
  async findByCode(@Query('code') code: string) {
    if (!code || !code.trim()) return null;
    return this.codesService.findByCode(code);
  }

  // =========================
  // MASIVO
  // =========================
  @Post('bulk-lookup')
  async bulkLookup(@Body('codes') codes: string[]) {
    if (!Array.isArray(codes) || !codes.length) return [];
    return this.codesService.bulkLookup(codes);
  }

  // =========================
  // BAJA (individual + masiva)
  // =========================
  @Patch(':id(\\d+)/baja')
  async bajaOne(@Param('id') id: string, @Body('baja') baja: boolean) {
    try {
      return await this.codesService.setBaja(BigInt(id), Boolean(baja));
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Error en setBaja', where: 'bajaOne' };
    }
  }

  @Patch('bulk-baja')
  async bajaBulk(@Body('ids') ids: number[], @Body('baja') baja: boolean) {
    try {
      const list = Array.isArray(ids) ? ids : [];
      if (list.length === 0) {
        return { ok: false, error: 'ids debe ser un array no vacío', where: 'bulk-baja' };
      }
      return await this.codesService.bulkBaja(list, Boolean(baja));
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Error en bulk-baja', where: 'bulk-baja' };
    }
  }

  @Patch('bulk-m13')
  async bulkM13(@Body() body: { ids?: number[]; m13?: boolean }) {
    try {
      const { ids, m13 } = body || {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return { ok: false, error: 'ids debe ser un array no vacío', where: 'bulk-m13' };
      }
      if (typeof m13 !== 'boolean') {
        return { ok: false, error: 'm13 debe ser boolean', where: 'bulk-m13' };
      }
      const safeIds: number[] = [];
      for (const raw of ids) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) {
          return { ok: false, error: `id inválido: ${String(raw)}`, where: 'bulk-m13' };
        }
        safeIds.push(n);
      }
      return await this.codesService.bulkUpdate(safeIds, { m13 });
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Error en bulk-m13', where: 'bulk-m13' };
    }
  }

  // =========================
  // COMENTARIOS (bitácora)
  // =========================
  @Get(':id(\\d+)/comments')
  async getComments(@Param('id') id: string) {
    return this.codesService.getComments(BigInt(id));
  }

  @Post(':id(\\d+)/comments')
  async addComment(
    @Param('id') id: string,
    @Body('comentario') comentario: string,
    @Body('actor') actor?: Actor,
  ) {
    return this.codesService.addComment(BigInt(id), comentario, actor);
  }

  // =========================
  // UPDATE INDIVIDUAL (al final)
  // =========================
  @Patch(':id(\\d+)')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      encargado_actual?: string | null;
      encargado_anterior?: string | null;
      comentario?: string | null;
      grupo_id?: number | null;
      razon_social?: string | null;
      direccion?: string | null;
      municipio?: string | null;
      estado?: string | null;
      m13?: boolean | null;
      actor?: Actor;
    },
  ) {
    const { actor, ...data } = body;
    return this.codesService.update(BigInt(id), data, actor);
  }

  @Get(':id(\\d+)')
  async findOne(@Param('id') id: string) {
    return this.codesService.findOne(BigInt(id));
  }
}
