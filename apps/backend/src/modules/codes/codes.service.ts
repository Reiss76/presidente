import { Injectable, BadRequestException, InternalServerErrorException, NotFoundException, UnauthorizedException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import * as crypto from 'crypto';

const GROUP_LABELS: Record<number, string> = {
  1: 'Gr-2000',
  2: 'Gr-500',
  3: 'Gr-Int',
  4: 'Gr-Ext',
};
const NO_GROUP_LABEL = 'SIN GRUPO';
const MAX_CSV_EXPORT_ROWS = 10000;
// Approximate kilometers per degree of latitude (used for bounding box calculations)
const KM_PER_DEGREE_LAT = 111;

export interface CodeItem {
  id: number;
  code: string;
  razon_social?: string | null;
  estado?: string | null;
  municipio?: string | null;
  direccion?: string | null;
  grupo_id?: number | null;
  encargado_actual?: string | null;
  encargado_anterior?: string | null;
  comentario?: string | null; // snapshot (último)
  baja?: boolean | null; // se llena por SQL (puede ser null si no existe columna)

  calibracion?: string | null; // ✅ NUEVO: "S" o "R"
  m13?: boolean | null;
}

export type Actor = {
  username?: string | null;
  role?: string | null;
};

export type CommentItem = {
  id: number;
  code_id: number;
  comentario: string;
  created_at: Date;
  actor_username?: string | null;
  actor_role?: string | null;
};

export type GeocodeResult = {
  code: string;
  status: 'updated' | 'failed';
  lat?: number;
  lon?: number;
  reason?: string;
  error?: string;
  address: string;
};

export type GeocodeMissingResponse = {
  processed: number;
  updated: number;
  failed: number;
  retried: number;
  overLimitCount: number;
  lastIdProcessed: bigint | null;
  elapsedMs: number;
  sampleUpdated: GeocodeResult[];
  sampleFailed: GeocodeResult[];
};

type DashboardCommentRow = {
  id: bigint;
  code_id: bigint;
  code: string | null;
  comentario: string;
  created_at: Date;
  actor_username?: string | null;
  actor_role?: string | null;
};

// =====================
// Normalización por núcleo
// =====================
function extractPureCode(input: string): string {
  if (!input) return '';
  const clean = String(input).toUpperCase().replace(/\s+/g, '');

  const match = clean.match(/PL\/(\d+)\//);
  if (match?.[1]) return match[1];

  if (/^\d+$/.test(clean)) return clean;

  const digits = clean.match(/\d+/);
  return digits ? digits[0] : '';
}

function normActor(actor?: Actor) {
  const username = actor?.username ? String(actor.username).trim() : '';
  const role = actor?.role ? String(actor.role).trim() : '';
  return {
    actor_username: username || null,
    actor_role: role || null,
  };
}

const VISIT_TYPES = ['verificacion', 'calibracion', 'supervision', 'cateo'] as const;
type VisitType = (typeof VISIT_TYPES)[number];
// Always expose these visit types even if the visits table has no rows for them.
const REQUIRED_VISIT_TYPES = ['cateo'] as const;

type DashboardFilters = {
  usuario?: string;
  subUsuario?: string;
  estado?: string;
  municipio?: string;
  grupoId?: number;
  calibracion?: 'S' | 'R';
  calibracionNone?: boolean;
  m13?: boolean;
  baja?: boolean;
  visitType?: VisitType;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  includeVisits: boolean;
  page: number;
  pageSize: number;
  offset?: number;
  sort: 'latestVisit' | 'code' | 'estado' | 'municipio';
  order: 'asc' | 'desc';
};

function parseBoolParam(value: any): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const v = String(value).trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
}

function parseISODateOnly(value?: any): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const v = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  return v;
}

function formatDateOnly(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function defaultDateRange(days = 30) {
  const today = new Date();
  // Use yesterday as the end of the range to cover the last complete days window.
  const to = new Date(today);
  to.setDate(to.getDate() - 1);
  const from = new Date(to);
  from.setDate(from.getDate() - (days - 1));
  return { from: formatDateOnly(from), to: formatDateOnly(to) };
}

function escapeForLike(value: string) {
  return value.replace(/[%_]/g, (m) => `\\${m}`);
}

function safeVisitType(value?: string | null): VisitType | undefined {
  if (!value) return undefined;
  const v = String(value).trim().toLowerCase();
  return VISIT_TYPES.includes(v as VisitType) ? (v as VisitType) : undefined;
}

function groupLabel(id?: number | null, name?: string | null) {
  if (id === null || id === undefined) return NO_GROUP_LABEL;
  if (name && String(name).trim()) return String(name).trim();
  return GROUP_LABELS[id] ?? `Gr-${id}`;
}

@Injectable()
export class CodesService {
  private readonly logger = new Logger(CodesService.name);
  constructor(
    private prisma: PrismaService,
    private geocodingService: GeocodingService,
  ) {}

  // ✅ Incluimos "baja" en baseSelect ya que el schema.prisma lo tiene
  private baseSelect = {
    id: true,
    code: true,
    razon_social: true,
    estado: true,
    municipio: true,
    direccion: true,
    grupo_id: true,
    encargado_actual: true,
    encargado_anterior: true,
    comentario: true,

    calibracion: true, // ✅ NUEVO
    m13: true,
    baja: true, // ✅ Campo baja para Mapas
  };

  private mapRow(row: any): CodeItem {
    return {
      id: Number(row.id),
      code: row.code,
      razon_social: row.razon_social ?? null,
      estado: row.estado ?? null,
      municipio: row.municipio ?? null,
      direccion: row.direccion ?? null,
      grupo_id: row.grupo_id ?? null,
      encargado_actual: row.encargado_actual ?? null,
      encargado_anterior: row.encargado_anterior ?? null,
      comentario: row.comentario ?? null,
      baja: row.baja === undefined || row.baja === null ? null : Boolean(row.baja),

      calibracion: row.calibracion ?? null, // ✅ NUEVO
      m13: row.m13 === undefined || row.m13 === null ? null : Boolean(row.m13),
    };
  }

  private normalizeDashboardParams(
    params: Record<string, any>,
    maxPageSize = 500,
    defaultPageSize = 50,
  ): DashboardFilters {
    const safeMaxPageSize = Math.max(1, Math.min(maxPageSize, MAX_CSV_EXPORT_ROWS));
    const usuarioRaw = params.usuario ?? params.user;
    const subUsuarioRaw = params.subUsuario ?? params.sub ?? params.subusuario;
    const usuario = usuarioRaw ? String(usuarioRaw).trim() : undefined;
    const subUsuario = subUsuarioRaw ? String(subUsuarioRaw).trim() : undefined;
    const estado = params.estado ? String(params.estado).trim() : undefined;
    const municipio = params.municipio ? String(params.municipio).trim() : undefined;

    let grupoId: number | undefined;
    const grupoRaw = params.grupoId ?? params.grupo ?? params.grupo_id;
    if (grupoRaw !== undefined && grupoRaw !== null && grupoRaw !== '') {
      const g = Number(grupoRaw);
      if (!Number.isInteger(g)) {
        throw new BadRequestException('grupoId debe ser entero');
      }
      grupoId = g;
    }

    let calibracion: 'S' | 'R' | undefined;
    let calibracionNone = false;
    const calRaw = params.calibracion;
    if (calRaw !== undefined && calRaw !== null && calRaw !== '') {
      const c = String(calRaw).trim().toUpperCase();
      if (c === 'NONE') {
        calibracionNone = true;
      } else if (c === 'S' || c === 'R') {
        calibracion = c as 'S' | 'R';
      } else {
        throw new BadRequestException('calibracion debe ser S, R o NONE');
      }
    }
    if (calibracion && calibracionNone) {
      throw new BadRequestException('calibracion y calibracion=NONE son excluyentes');
    }

    const m13Parsed = parseBoolParam(params.m13);
    if (params.m13 !== undefined && params.m13 !== null && params.m13 !== '' && m13Parsed === undefined) {
      throw new BadRequestException('m13 debe ser true o false');
    }

    const bajaParsed = parseBoolParam(params.baja);
    if (params.baja !== undefined && params.baja !== null && params.baja !== '' && bajaParsed === undefined) {
      throw new BadRequestException('baja debe ser true o false');
    }

    const includeVisitsParsed = parseBoolParam(params.includeVisits);
    if (
      params.includeVisits !== undefined &&
      params.includeVisits !== null &&
      params.includeVisits !== '' &&
      includeVisitsParsed === undefined
    ) {
      throw new BadRequestException('includeVisits debe ser true o false');
    }

    const visitTypeRaw = params.visitType ?? params.visit_type;
    const visitType = safeVisitType(visitTypeRaw);
    if (visitTypeRaw !== undefined && visitTypeRaw !== null && visitTypeRaw !== '' && !visitType) {
      throw new BadRequestException('visitType inválido');
    }

    const dateFromRaw = params.dateFrom ?? params.from;
    const dateFrom = parseISODateOnly(dateFromRaw);
    if (dateFromRaw !== undefined && dateFromRaw !== null && dateFromRaw !== '' && !dateFrom) {
      throw new BadRequestException('dateFrom inválido (YYYY-MM-DD)');
    }

    const dateToRaw = params.dateTo ?? params.to;
    const dateTo = parseISODateOnly(dateToRaw);
    if (dateToRaw !== undefined && dateToRaw !== null && dateToRaw !== '' && !dateTo) {
      throw new BadRequestException('dateTo inválido (YYYY-MM-DD)');
    }

    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new BadRequestException('dateFrom no puede ser mayor a dateTo');
    }

    const q = params.q ? String(params.q).trim() : undefined;

    let page = 1;
    if (params.page !== undefined && params.page !== null && params.page !== '') {
      const p = Number(params.page);
      if (!Number.isFinite(p) || p < 1) {
        throw new BadRequestException('page debe ser entero positivo');
      }
      page = Math.floor(p);
    }

    let pageSize = Math.min(safeMaxPageSize, defaultPageSize);
    const limitRaw = params.limit;
    if (limitRaw !== undefined && limitRaw !== null && limitRaw !== '') {
      const l = Number(limitRaw);
      if (!Number.isFinite(l) || l < 1) {
        throw new BadRequestException('limit debe ser entero positivo');
      }
      pageSize = Math.max(1, Math.min(safeMaxPageSize, Math.floor(l)));
    } else if (params.pageSize !== undefined && params.pageSize !== null && params.pageSize !== '') {
      const ps = Number(params.pageSize);
      if (!Number.isFinite(ps) || ps < 1) {
        throw new BadRequestException('pageSize debe ser entero positivo');
      }
      pageSize = Math.max(1, Math.min(safeMaxPageSize, Math.floor(ps)));
    }

    let offset: number | undefined;
    const offsetRaw = params.offset;
    if (offsetRaw !== undefined && offsetRaw !== null && offsetRaw !== '') {
      const o = Number(offsetRaw);
      if (!Number.isFinite(o) || o < 0) {
        throw new BadRequestException('offset debe ser un entero >= 0');
      }
      offset = Math.floor(o);
    }

    const sortRaw = String(params.sort || 'latestVisit').trim();
    const sort: DashboardFilters['sort'] =
      sortRaw === 'code' || sortRaw === 'estado' || sortRaw === 'municipio'
        ? (sortRaw as DashboardFilters['sort'])
        : 'latestVisit';

    const order: DashboardFilters['order'] = String(params.order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    return {
      usuario: usuario || undefined,
      subUsuario: subUsuario || undefined,
      estado: estado || undefined,
      municipio: municipio || undefined,
      grupoId,
      calibracion,
      calibracionNone,
      m13: m13Parsed,
      baja: bajaParsed,
      visitType,
      dateFrom,
      dateTo,
      q: q || undefined,
      includeVisits: includeVisitsParsed ?? false,
      page,
      pageSize,
      offset,
      sort,
      order,
    };
  }

  private buildCodeConditions(filters: DashboardFilters, alias = 'c'): Prisma.Sql[] {
    const col = (name: string) => Prisma.raw(`${alias}.${name}`);
    const conds: Prisma.Sql[] = [];

    if (filters.usuario) conds.push(Prisma.sql`${col('encargado_actual')} = ${filters.usuario}`);
    if (filters.subUsuario) conds.push(Prisma.sql`${col('encargado_anterior')} = ${filters.subUsuario}`);
    if (filters.estado) {
      const estadoEscaped = escapeForLike(filters.estado);
      conds.push(Prisma.sql`${col('estado')} ILIKE '%' || ${estadoEscaped} || '%' ESCAPE '\\'`);
    }
    if (filters.municipio) {
      const municipioEscaped = escapeForLike(filters.municipio);
      conds.push(Prisma.sql`${col('municipio')} ILIKE '%' || ${municipioEscaped} || '%' ESCAPE '\\'`);
    }
    if (typeof filters.grupoId === 'number')
      conds.push(Prisma.sql`${col('grupo_id')} = ${filters.grupoId}`);
    if (filters.calibracion) conds.push(Prisma.sql`${col('calibracion')} = ${filters.calibracion}`);
    if (filters.calibracionNone)
      conds.push(Prisma.sql`(${col('calibracion')} IS NULL OR TRIM(${col('calibracion')}::text) = '')`);
    if (filters.m13 !== undefined) conds.push(Prisma.sql`${col('m13')} = ${filters.m13}`);
    if (filters.baja !== undefined) conds.push(Prisma.sql`${col('baja')} = ${filters.baja}`);
    if (filters.q) {
      const escaped = escapeForLike(filters.q);
      conds.push(
        Prisma.sql`(${col('code')} ILIKE '%' || ${escaped} || '%' ESCAPE '\\' OR ${col(
          'razon_social',
        )} ILIKE '%' || ${escaped} || '%' ESCAPE '\\' OR ${col(
          'direccion',
        )} ILIKE '%' || ${escaped} || '%' ESCAPE '\\' OR ${col('municipio')} ILIKE '%' || ${escaped} || '%' ESCAPE '\\' OR ${col(
          'estado',
        )} ILIKE '%' || ${escaped} || '%' ESCAPE '\\')`,
      );
    }

    return conds;
  }

  private buildWhereSql(filters: DashboardFilters, alias = 'c') {
    const conds = this.buildCodeConditions(filters, alias);
    return conds.length ? Prisma.join(conds, ' AND ') : Prisma.sql`1=1`;
  }

  // =========================================================
  // CATÁLOGOS DEPENDIENTES (Estado / Municipio)
  // =========================================================
  async listStates(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ estado: string }[]>`
      SELECT DISTINCT estado
      FROM "codes"
      WHERE estado IS NOT NULL AND TRIM(estado) <> ''
      ORDER BY estado ASC;
    `;
    return rows.map((r) => r.estado);
  }

  async listMunicipalities(estado: string): Promise<string[]> {
    const e = (estado || '').trim();
    if (!e) return [];

    const rows = await this.prisma.$queryRaw<{ municipio: string }[]>`
      SELECT DISTINCT municipio
      FROM "codes"
      WHERE estado = ${e}
        AND municipio IS NOT NULL AND TRIM(municipio) <> ''
      ORDER BY municipio ASC;
    `;
    return rows.map((r) => r.municipio);
  }

  // =========================================================
  // Helper: “inyectar” baja por SQL a rows seleccionadas por Prisma
  // =========================================================
  private async attachBaja(rows: any[]): Promise<any[]> {
    if (!rows?.length) return rows;

    const ids = rows.map((r) => r.id);

    try {
      const bajas = await this.prisma.$queryRaw<
        { id: bigint; baja: boolean | null }[]
      >`
        SELECT id, baja
        FROM "codes"
        WHERE id = ANY(${ids}::bigint[]);
      `;

      const map = new Map<string, boolean | null>();
      for (const b of bajas) {
        map.set(String(b.id), b.baja === null ? null : Boolean(b.baja));
      }

      return rows.map((r) => ({ ...r, baja: map.get(String(r.id)) ?? null }));
    } catch {
      return rows.map((r) => ({ ...r, baja: null }));
    }
  }

  // =========================================================
  // BÚSQUEDA GENERAL (texto) — Prisma + baja por SQL
  // =========================================================
  async search(query?: string) {
    const q = (query || '').trim();
    const where: any = {};

    if (q) {
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { razon_social: { contains: q, mode: 'insensitive' } },
        { direccion: { contains: q, mode: 'insensitive' } },
        { municipio: { contains: q, mode: 'insensitive' } },
        { estado: { contains: q, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.code.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 100,
      select: this.baseSelect,
    });

    const rowsWithBaja = await this.attachBaja(rows);
    return { items: rowsWithBaja.map((r) => this.mapRow(r)) };
  }

  // =========================================================
  // BÚSQUEDA POR CÓDIGO — SIEMPRE por núcleo (Prisma + baja por SQL)
  // =========================================================
  async findByCode(rawCode: string) {
    const core = extractPureCode(rawCode);
    if (!core) return null;

    const row = await this.prisma.code.findFirst({
      where: {
        code: {
          startsWith: `PL/${core}/`,
          mode: 'insensitive',
        },
      },
      orderBy: { id: 'asc' },
      select: this.baseSelect,
    });

    if (!row) return null;

    return this.mapRow(row);
  }

  // =========================================================
  // DETALLE POR ID — Prisma + (baja por SQL opcional)
  // =========================================================
  async findOne(id: bigint) {
    const row = await this.prisma.code.findUnique({
      where: { id },
      select: this.baseSelect,
    });
    if (!row) return null;

    // Intentamos leer "baja" por SQL (si existe columna)
    let baja: boolean | null = null;
    try {
      const r = await this.prisma.$queryRaw<any[]>`
        SELECT baja
        FROM "codes"
        WHERE id = ${id}
        LIMIT 1;
      `;
      if (r?.length) baja = r[0]?.baja === null ? null : Boolean(r[0]?.baja);
    } catch {
      baja = null;
    }

    return { ...this.mapRow(row), baja };
  }

  // =========================================================
  // UPDATE INDIVIDUAL (con actor opcional para comentario)
  // =========================================================
  async update(id: bigint, data: Partial<CodeItem>, actor?: Actor) {
    const comentarioNuevo =
      data.comentario !== undefined && data.comentario !== null
        ? String(data.comentario).trim()
        : '';

    // Update general (sin forzar comentario aquí)
    await this.prisma.code.update({
      where: { id },
      data: {
        encargado_actual:
          data.encargado_actual !== undefined ? data.encargado_actual : undefined,
        encargado_anterior:
          data.encargado_anterior !== undefined
            ? data.encargado_anterior
            : undefined,
        grupo_id:
          data.grupo_id !== undefined && data.grupo_id !== null
            ? Number(data.grupo_id)
            : undefined,
        razon_social:
          data.razon_social !== undefined ? data.razon_social : undefined,
        direccion: data.direccion !== undefined ? data.direccion : undefined,
        municipio: data.municipio !== undefined ? data.municipio : undefined,
        estado: data.estado !== undefined ? data.estado : undefined,

        calibracion:
          data.calibracion !== undefined ? data.calibracion : undefined, // ✅ NUEVO
        m13: data.m13 !== undefined ? Boolean(data.m13) : undefined,
      },
    });

    // Comentario -> bitácora + snapshot
    if (comentarioNuevo) {
      await this.addComment(id, comentarioNuevo, actor);
    }

    return this.findOne(id);
  }

  // =========================================================
  // BÚSQUEDA MASIVA — por núcleo, mantiene orden
  // =========================================================
  async bulkLookup(codes: string[]) {
    const cleanInputs = (Array.isArray(codes) ? codes : [])
      .map((c) => String(c ?? '').trim())
      .filter((c) => c.length > 0);

    const cores = cleanInputs.map(extractPureCode).filter(Boolean);
    if (!cores.length) return [];

    const cache = new Map<string, CodeItem | null>();
    const results: CodeItem[] = [];

    for (const core of cores) {
      if (!cache.has(core)) {
        cache.set(core, await this.findByCode(core));
      }
      const found = cache.get(core);
      if (found) results.push(found);
    }

    return results;
  }

  // =========================================================
  // UPDATE MASIVO (con actor opcional para comentario)
  // =========================================================
  async bulkUpdate(
    ids: number[],
    data: {
      encargado_actual?: string | null;
      grupo_id?: number | null;
      encargado_anterior?: string | null;
      comentario?: string | null;

      calibracion?: string | null; // ✅ NUEVO
      m13?: boolean | null;
    },
    actor?: Actor,
    force_user_change?: boolean,
    auth_password?: string,
  ) {
    if (!ids.length) {
      return { updated: [] as CodeItem[], skipped: [] as any[] };
    }

    const idsBig = ids.map((x) => BigInt(x));

    const current = await this.prisma.code.findMany({
      where: { id: { in: idsBig } },
      select: { id: true, code: true, encargado_actual: true },
      orderBy: { id: 'asc' },
    });

    // Detectar si el request intenta cambiar usuario
    const newUser = data.encargado_actual;
    const changingUser = !!(newUser && String(newUser).trim() !== '');

    let skipped: { id: number; code: string; encargado_actual: string | null }[] =
      [];
    let idsForUser: bigint[] = [];

    // Lógica de cambio de usuario
    if (changingUser) {
      // Modo de cambio masivo forzado
      if (force_user_change === true) {
        // Validar que se haya proporcionado auth_password
        if (!auth_password || auth_password === '') {
          throw new BadRequestException('Contraseña requerida');
        }

        // Validar que actor tenga username
        if (!actor?.username || String(actor.username).trim() === '') {
          throw new BadRequestException('Usuario no identificado');
        }

        // Validar la contraseña del usuario
        const username = String(actor.username).trim();
        const password = String(auth_password);
        
        const user = await this.validateUser(username, password);
        if (!user) {
          throw new UnauthorizedException('Contraseña incorrecta');
        }

        // Si la validación es exitosa, actualizar TODOS los códigos
        idsForUser = idsBig;
        skipped = [];
      } else {
        // Modo normal: NO sobrescribir usuario si ya tiene
        const conUsuario = current.filter(
          (r) => r.encargado_actual && String(r.encargado_actual).trim() !== '',
        );

        skipped = conUsuario.map((r) => ({
          id: Number(r.id),
          code: r.code,
          encargado_actual: r.encargado_actual,
        }));

        idsForUser = current
          .filter((r) => !r.encargado_actual || !String(r.encargado_actual).trim())
          .map((r) => r.id);
      }
    }

    const hasGroup = data.grupo_id !== undefined && data.grupo_id !== null;
    const hasSub = data.encargado_anterior !== undefined;
    const hasComentario =
      data.comentario !== undefined &&
      data.comentario !== null &&
      String(data.comentario).trim() !== '';

    const hasCal = data.calibracion !== undefined; // ✅ NUEVO
    const hasM13 = data.m13 !== undefined;

    // 1) Grupo/Sub/Calibración para todos
    await this.prisma.code.updateMany({
      where: { id: { in: idsBig } },
      data: {
        grupo_id: hasGroup ? Number(data.grupo_id) : undefined,
        encargado_anterior: hasSub ? data.encargado_anterior : undefined,

        calibracion: hasCal ? data.calibracion : undefined, // ✅ NUEVO
        m13: hasM13 ? Boolean(data.m13) : undefined,
      },
    });

    // 2) Usuario solo a los que no tenían (o a todos si force_user_change)
    if (changingUser && idsForUser.length) {
      await this.prisma.code.updateMany({
        where: { id: { in: idsForUser } },
        data: { encargado_actual: data.encargado_actual },
      });
    }

    // 3) Comentario -> bitácora para cada código + snapshot
    if (hasComentario) {
      const txt = String(data.comentario).trim();
      for (const id of idsBig) {
        await this.addComment(id, txt, actor);
      }
    }

    // devolver todos (y que cada uno tenga baja por findOne)
    const updated = await Promise.all(idsBig.map((id) => this.findOne(id)));
    return { updated: updated.filter(Boolean) as CodeItem[], skipped };
  }

  // =========================================================
  // CREAR CÓDIGO
  // =========================================================
  async createCode(data: {
    code: string;
    razon_social: string;
    estado: string;
    municipio: string;
    direccion: string;
  }) {
    const code = (data.code || '').trim();
    const razon_social = (data.razon_social || '').trim();
    const estado = (data.estado || '').trim();
    const municipio = (data.municipio || '').trim();
    const direccion = (data.direccion || '').trim();

    if (!code || !razon_social || !estado || !municipio || !direccion) {
      throw new BadRequestException(
        'Código, Razón Social, Estado, Municipio y Dirección son obligatorios.',
      );
    }

    const exists = await this.prisma.code.findFirst({ where: { code } });
    if (exists) throw new BadRequestException('Ya existe un código con ese valor.');

    const row = await this.prisma.code.create({
      data: { code, razon_social, estado, municipio, direccion },
      select: this.baseSelect,
    });

    const [rowWithBaja] = await this.attachBaja([row]);
    return this.mapRow(rowWithBaja);
  }

  // =========================================================
  // CATÁLOGOS
  // =========================================================
  async createGroup(name: string) {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;

    const rows = await this.prisma.$queryRaw<{ id: bigint; name: string }[]>`
      INSERT INTO groups (name)
      VALUES (${trimmed})
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name;
    `;
    if (!rows.length) return null;
    return { id: Number(rows[0].id), name: rows[0].name };
  }

  async createEncargado(nombre: string) {
    const trimmed = (nombre || '').trim();
    if (!trimmed) return null;

    const rows = await this.prisma.$queryRaw<{ id: bigint; nombre: string }[]>`
      INSERT INTO encargados (nombre)
      VALUES (${trimmed})
      ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
      RETURNING id, nombre;
    `;
    if (!rows.length) return null;
    return { id: Number(rows[0].id), nombre: rows[0].nombre };
  }

  async createSubEncargado(nombre: string) {
    const trimmed = (nombre || '').trim();
    if (!trimmed) return null;

    const rows = await this.prisma.$queryRaw<{ id: bigint; nombre: string }[]>`
      INSERT INTO sub_encargados (nombre)
      VALUES (${trimmed})
      ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
      RETURNING id, nombre;
    `;
    if (!rows.length) return null;
    return { id: Number(rows[0].id), nombre: rows[0].nombre };
  }

  async getCatalogs() {
    let groupsTableAvailable = true;
    let groups: { id: number; name: string }[] = [];
    try {
      const rows = await this.prisma.$queryRaw<{ id: bigint; name: string | null }[]>`
        SELECT id, name FROM groups ORDER BY name ASC;
      `;
      groups = rows.map((g) => {
        const id = Number(g.id);
        const name = (g.name ?? '').trim();
        return { id, name: name || groupLabel(id) };
      });
    } catch (err) {
      this.logger.warn('Failed to fetch groups from groups table', err);
      groupsTableAvailable = false;
    }

    // If the groups table is available but empty, fall back to the codes table.
    if (!groups.length && groupsTableAvailable) {
      try {
        const rows = await this.prisma.$queryRaw<{ grupo_id: number | null; name?: string | null }[]>`
          SELECT DISTINCT c.grupo_id, g.name
          FROM codes c
          LEFT JOIN groups g ON g.id = c.grupo_id
          WHERE c.grupo_id IS NOT NULL
          ORDER BY c.grupo_id ASC;
        `;
        groups = rows
          .filter((g) => g.grupo_id !== null)
          .map((g) => {
            const id = Number(g.grupo_id);
            const name = (g.name ?? '').trim();
            return { id, name: name || groupLabel(id) };
          });
      } catch (err) {
        this.logger.warn('Fallback join to groups failed, using codes.grupo_id only', err);
        groupsTableAvailable = false;
      }
    }

    if (!groups.length) {
      const rows = await this.prisma.$queryRaw<{ grupo_id: number | null }[]>`
        SELECT DISTINCT grupo_id
        FROM codes
        WHERE grupo_id IS NOT NULL
        ORDER BY grupo_id ASC;
      `;
      groups = rows
        .filter((g) => g.grupo_id !== null)
        .map((g) => {
          const id = Number(g.grupo_id);
          return { id, name: groupLabel(id) };
        });
    }

    let encargados: { id: bigint; nombre: string }[] = [];
    let subEncargados: { id: bigint; nombre: string }[] = [];
    let estados: { estado: string }[] = [];
    let municipios: { municipio: string }[] = [];
    let visitTypesRows: { visit_type: string | null }[] = [];
    try {
      [encargados, subEncargados, estados, municipios, visitTypesRows] = await this.prisma.$transaction([
        this.prisma.$queryRaw<{ id: bigint; nombre: string }[]>`
          SELECT id, nombre FROM encargados ORDER BY nombre ASC;
        `,
        this.prisma.$queryRaw<{ id: bigint; nombre: string }[]>`
          SELECT id, nombre FROM sub_encargados ORDER BY nombre ASC;
        `,
        this.prisma.$queryRaw<{ estado: string }[]>`
          SELECT DISTINCT estado
          FROM codes
          WHERE estado IS NOT NULL AND TRIM(estado) <> ''
          ORDER BY estado ASC;
        `,
        this.prisma.$queryRaw<{ municipio: string }[]>`
          SELECT DISTINCT municipio
          FROM codes
          WHERE municipio IS NOT NULL AND TRIM(municipio) <> ''
          ORDER BY municipio ASC;
        `,
        this.prisma.$queryRaw<{ visit_type: string | null }[]>`
          SELECT DISTINCT visit_type
          FROM code_visits
          WHERE visit_type IS NOT NULL AND TRIM(visit_type) <> ''
          ORDER BY visit_type ASC;
        `,
      ]);
    } catch (err) {
      this.logger.error('Failed to fetch catalogs data', err);
      throw err;
    }

    const visitTypes = Array.from(
      new Set<string>([
        ...visitTypesRows
          .map((v) => (v.visit_type ?? '').trim().toLowerCase())
          .filter((v) => v),
        ...REQUIRED_VISIT_TYPES.map((vt) => vt.toLowerCase()),
      ]),
    ).sort();

    return {
      groups,
      encargados: encargados.map((e) => ({ id: Number(e.id), nombre: e.nombre })),
      subEncargados: subEncargados.map((e) => ({ id: Number(e.id), nombre: e.nombre })),
      estados: estados.map((e) => e.estado),
      municipios: municipios.map((m) => m.municipio),
      visitTypes,
    };
  }

  // =========================================================
  // COMENTARIOS (BITÁCORA)
  // =========================================================
  async getComments(codeId: bigint): Promise<CommentItem[]> {
    try {
      const rows = await this.prisma.$queryRaw<any[]>`
        SELECT id, code_id, comentario, created_at, actor_username, actor_role
        FROM code_comments
        WHERE code_id = ${codeId}
        ORDER BY created_at DESC;
      `;
      return rows.map((r) => ({
        id: Number(r.id),
        code_id: Number(r.code_id),
        comentario: r.comentario,
        created_at: r.created_at,
        actor_username: r.actor_username ?? null,
        actor_role: r.actor_role ?? null,
      }));
    } catch {
      const rows = await this.prisma.$queryRaw<any[]>`
        SELECT id, code_id, comentario, created_at
        FROM code_comments
        WHERE code_id = ${codeId}
        ORDER BY created_at DESC;
      `;
      return rows.map((r) => ({
        id: Number(r.id),
        code_id: Number(r.code_id),
        comentario: r.comentario,
        created_at: r.created_at,
        actor_username: null,
        actor_role: null,
      }));
    }
  }

  async addComment(codeId: bigint, comentario: string, actor?: Actor) {
    const trimmed = (comentario || '').trim();
    if (!trimmed) return null;

    const { actor_username, actor_role } = normActor(actor);

    // Intento 1: con actor_username/actor_role
    try {
      await this.prisma.$queryRaw<any[]>`
        INSERT INTO code_comments (code_id, comentario, actor_username, actor_role)
        VALUES (${codeId}, ${trimmed}, ${actor_username}, ${actor_role});
      `;
    } catch {
      // Fallback: sin actor
      await this.prisma.$queryRaw<any[]>`
        INSERT INTO code_comments (code_id, comentario)
        VALUES (${codeId}, ${trimmed});
      `;
    }

    // snapshot (último comentario)
    await this.prisma.code.update({
      where: { id: codeId },
      data: { comentario: trimmed },
    });

    return { ok: true };
  }

  // =========================================================
  // AUTH (app_users)
  // =========================================================
  async createAppUser(username: string, password: string, role: string = 'editor') {
    const u = (username || '').trim();
    const p = (password || '').trim();
    const r = (role || '').trim().toLowerCase();

    if (!u || !p) throw new Error('Usuario y contraseña requeridos');

    const roleValue = r === 'admin' ? 'admin' : 'editor';

    const rows = await this.prisma.$queryRaw<
      { id: bigint; username: string; password: string; role: string }[]
    >`
      INSERT INTO app_users (username, password, role)
      VALUES (${u}, ${p}, ${roleValue})
      ON CONFLICT (username)
      DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role
      RETURNING id, username, password, role;
    `;

    if (!rows.length) return null;
    const row = rows[0];
    return { id: Number(row.id), username: row.username, role: row.role };
  }

  async validateUser(username: string, password: string) {
    const u = (username || '').trim();
    const p = (password || '').trim();
    if (!u || !p) return null;

    const rows = await this.prisma.$queryRaw<
      { id: bigint; username: string; password: string; role: string }[]
    >`
      SELECT id, username, password, role
      FROM app_users
      WHERE username = ${u}
      LIMIT 1;
    `;

    if (!rows.length) return null;
    const row = rows[0];
    if (row.password !== p) return null;

    return { id: Number(row.id), username: row.username, role: row.role };
  }

  async listAppUsers() {
    const rows = await this.prisma.$queryRaw<{ id: bigint; username: string; role: string }[]>`
      SELECT id, username, role FROM app_users ORDER BY username ASC;
    `;
    return rows.map((r) => ({ id: Number(r.id), username: r.username, role: r.role }));
  }

  // =========================================================
  // DASHBOARD FILTRABLE (NUEVO)
  // =========================================================
  async dashboardFilters() {
    const [usuarios, subUsuarios, estados, municipios, grupos, calibraciones] = await this.prisma.$transaction([
      this.prisma.$queryRaw<{ usuario: string }[]>`
        SELECT DISTINCT TRIM(encargado_actual) AS usuario
        FROM codes
        WHERE encargado_actual IS NOT NULL AND TRIM(encargado_actual) <> ''
        ORDER BY usuario ASC;
      `,
      this.prisma.$queryRaw<{ usuario: string }[]>`
        SELECT DISTINCT TRIM(encargado_anterior) AS usuario
        FROM codes
        WHERE encargado_anterior IS NOT NULL AND TRIM(encargado_anterior) <> ''
        ORDER BY usuario ASC;
      `,
      this.prisma.$queryRaw<{ estado: string }[]>`
        SELECT DISTINCT estado
        FROM codes
        WHERE estado IS NOT NULL AND TRIM(estado) <> ''
        ORDER BY estado ASC;
      `,
      this.prisma.$queryRaw<{ municipio: string }[]>`
        SELECT DISTINCT municipio
        FROM codes
        WHERE municipio IS NOT NULL AND TRIM(municipio) <> ''
        ORDER BY municipio ASC;
      `,
      this.prisma.$queryRaw<{ grupo_id: number }[]>`
        SELECT DISTINCT grupo_id
        FROM codes
        WHERE grupo_id IS NOT NULL
        ORDER BY grupo_id ASC;
      `,
      this.prisma.$queryRaw<{ calibracion: string }[]>`
        SELECT DISTINCT calibracion
        FROM codes
        WHERE calibracion IS NOT NULL AND TRIM(calibracion) <> ''
        ORDER BY calibracion ASC;
      `,
    ]);

    const range = defaultDateRange(30);

    return {
      usuarios: usuarios.map((u) => u.usuario),
      subUsuarios: subUsuarios.map((u) => u.usuario),
      estados: estados.map((e) => e.estado),
      municipios: municipios.map((m) => m.municipio),
      grupos: grupos.map((g) => g.grupo_id),
      calibracion: calibraciones.map((c) => c.calibracion),
      m13: [true, false],
      baja: [true, false],
      visit_types: VISIT_TYPES,
      defaultDateRange: {
        from: range.from,
        to: range.to,
      },
    };
  }

  async dashboardCatalogs() {
    const [users, subs, estados, municipios] = await this.prisma.$transaction([
      this.prisma.$queryRaw<{ usuario: string }[]>`
        SELECT DISTINCT TRIM(encargado_actual) AS usuario
        FROM codes
        WHERE encargado_actual IS NOT NULL AND TRIM(encargado_actual) <> ''
        ORDER BY usuario ASC;
      `,
      this.prisma.$queryRaw<{ usuario: string }[]>`
        SELECT DISTINCT TRIM(encargado_anterior) AS usuario
        FROM codes
        WHERE encargado_anterior IS NOT NULL AND TRIM(encargado_anterior) <> ''
        ORDER BY usuario ASC;
      `,
      this.prisma.$queryRaw<{ estado: string }[]>`
        SELECT DISTINCT estado
        FROM codes
        WHERE estado IS NOT NULL AND TRIM(estado) <> ''
        ORDER BY estado ASC;
      `,
      this.prisma.$queryRaw<{ municipio: string }[]>`
        SELECT DISTINCT municipio
        FROM codes
        WHERE municipio IS NOT NULL AND TRIM(municipio) <> ''
        ORDER BY municipio ASC;
      `,
    ]);

    let grupos: { id: number; label: string }[] = [];
    try {
      const rows = await this.prisma.$queryRaw<{ id: bigint; name: string | null }[]>`
        SELECT id, name
        FROM groups
        ORDER BY name ASC, id ASC;
      `;
      grupos = rows.map((r) => {
        const id = Number(r.id);
        return { id, label: groupLabel(id, r.name) };
      });
    } catch (err) {
      this.logger.warn('Failed to fetch groups from groups table, falling back to codes.grupo_id', err as any);
      grupos = [];
    }

    if (!grupos.length) {
      const rows = await this.prisma.$queryRaw<{ grupo_id: number | null }[]>`
        SELECT DISTINCT grupo_id
        FROM codes
        WHERE grupo_id IS NOT NULL
        ORDER BY grupo_id ASC;
      `;
      grupos = rows
        .filter((r) => r.grupo_id !== null)
        .map((r) => ({ id: Number(r.grupo_id), label: groupLabel(Number(r.grupo_id)) }));
    }

    return {
      users: users.map((u) => u.usuario),
      subs: subs.map((u) => u.usuario),
      estados: estados.map((e) => e.estado),
      municipios: municipios.map((m) => m.municipio),
      grupos,
    };
  }

  private async executeDashboardQuery(
    filters: DashboardFilters,
    opts?: { forceIncludeVisits?: boolean },
  ) {
    const codesWhereSql = this.buildWhereSql(filters, 'c');
    const includeVisits = opts?.forceIncludeVisits ?? filters.includeVisits;
    const offset = filters.offset !== undefined ? filters.offset : (filters.page - 1) * filters.pageSize;
    const orderRaw = Prisma.raw(filters.order === 'asc' ? 'ASC' : 'DESC');

    const orderBySql: Prisma.Sql =
      filters.sort === 'code'
        ? Prisma.sql`fc.code ${orderRaw}`
        : filters.sort === 'estado'
          ? Prisma.sql`fc.estado ${orderRaw} NULLS LAST`
          : filters.sort === 'municipio'
            ? Prisma.sql`fc.municipio ${orderRaw} NULLS LAST`
            : Prisma.sql`lv.visit_date ${orderRaw} NULLS LAST`;

    const [metricsRow] = await this.prisma.$queryRaw<
      { total: bigint; assigned: bigint; m13count: bigint; cal_s: bigint; cal_r: bigint; baja_count: bigint }[]
    >`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE c.encargado_actual IS NOT NULL AND TRIM(c.encargado_actual) <> '')::bigint AS assigned,
        COUNT(*) FILTER (WHERE c.m13 = true)::bigint AS m13count,
        COUNT(*) FILTER (WHERE c.calibracion = 'S')::bigint AS cal_s,
        COUNT(*) FILTER (WHERE c.calibracion = 'R')::bigint AS cal_r,
        COUNT(*) FILTER (WHERE c.baja = true)::bigint AS baja_count
      FROM codes c
      WHERE ${codesWhereSql};
    `;

    const byGroupRows = await this.prisma.$queryRaw<{ grupo_id: number | null; count: bigint }[]>`
      SELECT c.grupo_id, COUNT(*)::bigint AS count
      FROM codes c
      WHERE ${codesWhereSql}
      GROUP BY c.grupo_id
      ORDER BY count DESC;
    `;

    const listRows = await this.prisma.$queryRaw<any[]>`
      WITH filtered_codes AS (
        SELECT *
        FROM codes c
        WHERE ${codesWhereSql}
      ),
      latest_visits AS (
        SELECT
          v.code_id,
          v.visit_date,
          v.visit_type,
          ROW_NUMBER() OVER (PARTITION BY v.code_id ORDER BY v.visit_date DESC, v.id DESC) AS rn
        FROM code_visits v
        JOIN filtered_codes fc ON fc.id = v.code_id
        WHERE (${filters.dateFrom}::date IS NULL OR v.visit_date >= ${filters.dateFrom}::date)
          AND (${filters.dateTo}::date IS NULL OR v.visit_date <= ${filters.dateTo}::date)
          AND (${filters.visitType}::text IS NULL OR v.visit_type = ${filters.visitType})
      )
      SELECT
        fc.id,
        fc.code,
        fc.razon_social,
        fc.estado,
        fc.municipio,
        fc.direccion,
        fc.grupo_id,
        fc.encargado_actual,
        fc.encargado_anterior,
        fc.calibracion,
        fc.m13,
        fc.baja,
        lv.visit_date AS latest_visit_date,
        lv.visit_type AS latest_visit_type
      FROM filtered_codes fc
      LEFT JOIN latest_visits lv ON lv.code_id = fc.id AND lv.rn = 1
      ORDER BY ${orderBySql}, fc.id DESC
      LIMIT ${filters.pageSize}
      OFFSET ${offset};
    `;

    const listItems = listRows.map((r) => ({
      id: Number(r.id),
      code: r.code,
      razon_social: r.razon_social,
      estado: r.estado,
      municipio: r.municipio,
      direccion: r.direccion,
      grupo_id: r.grupo_id === null ? null : Number(r.grupo_id),
      encargado_actual: r.encargado_actual,
      encargado_anterior: r.encargado_anterior,
      calibracion: r.calibracion,
      m13: r.m13 === null ? null : Boolean(r.m13),
      baja: r.baja === null ? null : Boolean(r.baja),
      latest_visit_date: r.latest_visit_date ?? null,
      latest_visit_type: r.latest_visit_type ?? null,
    }));

    let visitsData: {
      count: number;
      byType: Record<string, number>;
      last10: { id: number; code: string | null; visit_date: Date; visit_type: string }[];
    } = {
      count: 0,
      byType: {},
      last10: [],
    };

    if (includeVisits) {
      const [visitCountRow] = await this.prisma.$queryRaw<{ cnt: bigint }[]>`
        SELECT COUNT(*)::bigint AS cnt
        FROM code_visits v
        JOIN codes c ON c.id = v.code_id
        WHERE ${codesWhereSql}
          AND (${filters.dateFrom}::date IS NULL OR v.visit_date >= ${filters.dateFrom}::date)
          AND (${filters.dateTo}::date IS NULL OR v.visit_date <= ${filters.dateTo}::date)
          AND (${filters.visitType}::text IS NULL OR v.visit_type = ${filters.visitType});
      `;

      const visitsByTypeRows = await this.prisma.$queryRaw<{ visit_type: string; count: bigint }[]>`
        SELECT v.visit_type, COUNT(*)::bigint AS count
        FROM code_visits v
        JOIN codes c ON c.id = v.code_id
        WHERE ${codesWhereSql}
          AND (${filters.dateFrom}::date IS NULL OR v.visit_date >= ${filters.dateFrom}::date)
          AND (${filters.dateTo}::date IS NULL OR v.visit_date <= ${filters.dateTo}::date)
          AND (${filters.visitType}::text IS NULL OR v.visit_type = ${filters.visitType})
        GROUP BY v.visit_type;
      `;

      const lastVisitsRows = await this.prisma.$queryRaw<
        { id: bigint; code: string | null; visit_date: Date; visit_type: string }[]
      >`
        SELECT v.id, c.code, v.visit_date, v.visit_type
        FROM code_visits v
        JOIN codes c ON c.id = v.code_id
        WHERE ${codesWhereSql}
          AND (${filters.dateFrom}::date IS NULL OR v.visit_date >= ${filters.dateFrom}::date)
          AND (${filters.dateTo}::date IS NULL OR v.visit_date <= ${filters.dateTo}::date)
          AND (${filters.visitType}::text IS NULL OR v.visit_type = ${filters.visitType})
        ORDER BY v.visit_date DESC, v.id DESC
        LIMIT 10;
      `;

      visitsData = {
        count: Number(visitCountRow?.cnt ?? 0),
        byType: visitsByTypeRows.reduce<Record<string, number>>((acc, r) => {
          acc[r.visit_type] = Number(r.count);
          return acc;
        }, {}),
        last10: lastVisitsRows.map((r) => ({
          id: Number(r.id),
          code: r.code,
          visit_date: r.visit_date,
          visit_type: r.visit_type,
        })),
      };
    }

    let commentsRows: DashboardCommentRow[] = [];
    try {
      commentsRows = await this.prisma.$queryRaw<DashboardCommentRow[]>`
        SELECT
          cm.id,
          cm.code_id,
          c.code,
          cm.comentario,
          cm.created_at,
          cm.actor_username,
          cm.actor_role
        FROM code_comments cm
        JOIN codes c ON c.id = cm.code_id
        WHERE ${codesWhereSql}
        ORDER BY cm.created_at DESC
        LIMIT 10;
      `;
    } catch (err) {
      this.logger.error('code_comments query failed, returning empty list', err as any);
      commentsRows = [];
    }

    return {
      filtersApplied: {
        usuario: filters.usuario,
        subUsuario: filters.subUsuario,
        estado: filters.estado,
        municipio: filters.municipio,
        grupoId: filters.grupoId,
        calibracion: filters.calibracion,
        m13: filters.m13,
        baja: filters.baja,
        visitType: filters.visitType,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        q: filters.q,
        includeVisits,
        page: filters.page,
        pageSize: filters.pageSize,
        sort: filters.sort,
        order: filters.order,
      },
      codes: {
        total: Number(metricsRow?.total ?? 0),
        assignedCount: Number(metricsRow?.assigned ?? 0),
        m13Count: Number(metricsRow?.m13count ?? 0),
        calSolicitadas: Number(metricsRow?.cal_s ?? 0),
        calRealizadas: Number(metricsRow?.cal_r ?? 0),
        bajaCount: Number(metricsRow?.baja_count ?? 0),
        byGroup: byGroupRows.reduce<Record<string, number>>((acc, r) => {
          const key = r.grupo_id === null ? 'null' : String(r.grupo_id);
          acc[key] = Number(r.count);
          return acc;
        }, {}),
      },
      visits: visitsData,
      comments: {
        last10: commentsRows.map((r) => ({
          id: Number(r.id),
          code: r.code ?? null,
          comentario: r.comentario,
          created_at: r.created_at,
          actor_username: r.actor_username ?? null,
        })),
      },
      list: {
        page: filters.page,
        pageSize: filters.pageSize,
        totalRows: Number(metricsRow?.total ?? 0),
        items: listItems,
      },
    };
  }

  async dashboardQuery(params: Record<string, any>) {
    const filters = this.normalizeDashboardParams(params);
    return this.executeDashboardQuery(filters);
  }

  async dashboardResults(params: Record<string, any>) {
    const filters = this.normalizeDashboardParams(params, MAX_CSV_EXPORT_ROWS, 50);
    const range = !filters.dateFrom && !filters.dateTo ? defaultDateRange(30) : undefined;

    const adjustedFilters: DashboardFilters = {
      ...filters,
      includeVisits: true,
      dateFrom: filters.dateFrom ?? range?.from,
      dateTo: filters.dateTo ?? range?.to,
    };

    const data = await this.executeDashboardQuery(adjustedFilters, { forceIncludeVisits: true });

    return {
      metrics: {
        codes: {
          total: data.codes.total,
          byGroup: data.codes.byGroup,
          m13Count: data.codes.m13Count,
          assignedCount: data.codes.assignedCount,
          calSolicitadas: data.codes.calSolicitadas,
          calRealizadas: data.codes.calRealizadas,
          bajaCount: data.codes.bajaCount ?? 0,
        },
        visits: {
          rangeCount: data.visits.count,
          byType: data.visits.byType,
          last10: data.visits.last10,
        },
      },
      rows: data.list.items,
      totalRows: data.list.totalRows,
    };
  }

  async dashboardExportCsv(params: Record<string, any>) {
    const limit = params.limit ?? MAX_CSV_EXPORT_ROWS;
    const offset = params.offset ?? 0;
    const filters = this.normalizeDashboardParams(
      { ...params, limit, offset },
      MAX_CSV_EXPORT_ROWS,
      MAX_CSV_EXPORT_ROWS,
    );
    const range = !filters.dateFrom && !filters.dateTo ? defaultDateRange(30) : undefined;

    const adjustedFilters: DashboardFilters = {
      ...filters,
      includeVisits: true,
      dateFrom: filters.dateFrom ?? range?.from,
      dateTo: filters.dateTo ?? range?.to,
    };

    const data = await this.executeDashboardQuery(adjustedFilters, { forceIncludeVisits: true });

    const header = [
      'code',
      'razon_social',
      'estado',
      'municipio',
      'direccion',
      'grupo',
      'usuario',
      'sub',
      'calibracion',
      'm13',
      'baja',
      'latest_visit_date',
      'latest_visit_type',
    ];

    const rows = data.list.items.map((item) => {
      const grupoValor = item.grupo_id ?? '';
      const usuarioActual = item.encargado_actual ?? '';
      const subUsuario = item.encargado_anterior ?? '';

      return [
        item.code ?? '',
        item.razon_social ?? '',
        item.estado ?? '',
        item.municipio ?? '',
        item.direccion ?? '',
        grupoValor,
        usuarioActual,
        subUsuario,
        item.calibracion ?? '',
        item.m13 === null || item.m13 === undefined ? '' : item.m13,
        item.baja === null || item.baja === undefined ? '' : item.baja,
        item.latest_visit_date ?? '',
        item.latest_visit_type ?? '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',');
    });

    return [header.join(','), ...rows].join('\n');
  }

  // =========================================================
  // DASHBOARD (Prisma + baja por SQL)
  // =========================================================
  async dashboard(usuario?: string, estado?: string, municipio?: string) {
    const u = (usuario || '').trim();
    const e = (estado || '').trim();
    const m = (municipio || '').trim();

    const where: Prisma.CodeWhereInput = {};
    if (u) where.encargado_actual = u;
    if (e) where.estado = { contains: e, mode: 'insensitive' };
    if (m) where.municipio = { contains: m, mode: 'insensitive' };

    const [rows, calSolicitadas, calRealizadas] = await this.prisma.$transaction([
      this.prisma.code.findMany({
        where,
        select: this.baseSelect,
      }),
      this.prisma.code.count({
        where: { ...where, calibracion: 'S' },
      }),
      this.prisma.code.count({
        where: { ...where, calibracion: 'R' },
      }),
    ]);

    const rowsWithBaja = await this.attachBaja(rows);

    const total = rowsWithBaja.length;
    const asignados = rowsWithBaja.filter(
      (r) => r.encargado_actual && String(r.encargado_actual).trim() !== '',
    ).length;
    const sinAsignar = total - asignados;

    const porUsuario: Record<string, number> = {};
    const porEstado: Record<string, number> = {};
    const porMunicipio: Record<string, number> = {};
    const porGrupo: Record<string, number> = {};
    const porGrupoLabel: Record<string, string> = {};

    for (const r of rowsWithBaja) {
      const uu =
        r.encargado_actual && String(r.encargado_actual).trim() !== ''
          ? r.encargado_actual
          : 'SIN ASIGNAR';
      porUsuario[uu] = (porUsuario[uu] || 0) + 1;

      const ee = r.estado && String(r.estado).trim() !== '' ? r.estado : 'SIN ESTADO';
      porEstado[ee] = (porEstado[ee] || 0) + 1;

      const mm =
        r.municipio && String(r.municipio).trim() !== ''
          ? r.municipio
          : 'SIN MUNICIPIO';
      porMunicipio[mm] = (porMunicipio[mm] || 0) + 1;
      const groupKey = typeof r.grupo_id === 'number' ? String(r.grupo_id) : NO_GROUP_LABEL;
      porGrupo[groupKey] = (porGrupo[groupKey] || 0) + 1;
      if (!porGrupoLabel[groupKey]) {
        porGrupoLabel[groupKey] =
          groupKey === NO_GROUP_LABEL
            ? NO_GROUP_LABEL
            : GROUP_LABELS[Number(groupKey)] ?? `Gr-${groupKey}`;
      }
    }

    return {
      total,
      asignados,
      sinAsignar,
      porUsuario,
      porEstado,
      porMunicipio,
      items: rowsWithBaja.map((r) => this.mapRow(r)),
      extra: {
        assignedCount: asignados,
        calSolicitadas,
        calRealizadas,
        porGrupo,
        porGrupoLabel,
      },
    };
  }

  // =========================================================
  // BAJA (individual + masiva) — SQL directo sobre "codes"
  // =========================================================
  async setBaja(id: bigint, baja: boolean) {
    await this.prisma.$executeRaw<any>`
      UPDATE "codes"
      SET baja = ${Boolean(baja)}
      WHERE id = ${id};
    `;
    return this.findOne(id);
  }

  async bulkBaja(ids: number[], baja: boolean) {
    const idsBig = (Array.isArray(ids) ? ids : []).map((x) => BigInt(x));
    if (!idsBig.length) return { updated: [] as CodeItem[] };

    await this.prisma.$executeRaw<any>`
      UPDATE "codes"
      SET baja = ${Boolean(baja)}
      WHERE id = ANY(${idsBig}::bigint[]);
    `;

    const updated = await Promise.all(idsBig.map((id) => this.findOne(id)));
    return { updated: updated.filter(Boolean) as CodeItem[] };
  }

  // =========================================================
  // ASIGNACIONES (filtros por usuario / grupo / estado / municipio)
  // =========================================================
  async assigned(filters: {
    encargado?: string;
    grupo_id?: number;
    estado?: string;
    municipio?: string;
    include_baja?: boolean;
  }) {
    try {
      const where: any = {};

      if (filters.encargado && filters.encargado.trim() !== '') {
        where.encargado_actual = filters.encargado.trim();
      }

      if (typeof filters.grupo_id === 'number' && !isNaN(filters.grupo_id)) {
        where.grupo_id = filters.grupo_id;
      }

      if (filters.estado && filters.estado.trim() !== '') {
        where.estado = {
          contains: filters.estado.trim(),
          mode: 'insensitive',
        };
      }

      if (filters.municipio && filters.municipio.trim() !== '') {
        where.municipio = {
          contains: filters.municipio.trim(),
          mode: 'insensitive',
        };
      }

      // 1) Traer filas base
      const rows = await this.prisma.code.findMany({
        where,
        orderBy: { id: 'asc' },
        take: 5000,
        select: this.baseSelect,
      });

      // 2) Inyectar BAJA
      const withBaja = await this.attachBaja(rows);

      // 3) Filtrar bajas si no se incluyen
      const finalRows = filters.include_baja
        ? withBaja
        : withBaja.filter((r) => r.baja !== true);

      return {
        total: finalRows.length,
        items: finalRows.map((r) => this.mapRow(r)),
      };
    } catch (error) {
      console.error('ERROR /codes/assigned', error);
      return { total: 0, items: [] };
    }
  }

  // ==============================
// NEARBY CODES (geolocation)
// ==============================
async findNearby(
  codeInput: string,
  radiusKm: number,
  opts?: {
    includeBajas?: boolean;
    bajasMunicipio?: boolean;
    bajasEstado?: boolean;
    bajasRadioKm?: number;
    bajasLimit?: number;
  },
) {
  // Extract options with defaults
  const includeBajas = opts?.includeBajas ?? false;
  const bajasMunicipio = opts?.bajasMunicipio ?? false;
  const bajasEstado = opts?.bajasEstado ?? false;
  const bajasRadioKm = opts?.bajasRadioKm; // undefined if not provided
  const bajasLimit = opts?.bajasLimit ?? 200;
  try {
    // 1) Extract the pure code number from input
    let searchPattern: string;
    let exactCode: string | null = null;

    if (codeInput.includes('/')) {
      exactCode = codeInput.trim();
      const match = codeInput.match(/PL\/(\d+)\//i);
      searchPattern = match ? match[1] : codeInput;
    } else {
      searchPattern = codeInput.trim();
    }

    // 2) Find base code (same behavior as before)
    let baseCode: any;

    if (exactCode) {
      baseCode = await this.prisma.code.findFirst({
        where: { code: { equals: exactCode, mode: 'insensitive' } },
      });
    }

    if (!baseCode && searchPattern) {
      baseCode = await this.prisma.code.findFirst({
        where: {
          code: { contains: `/${searchPattern}/`, mode: 'insensitive' },
        },
      });
    }

    if (!baseCode && searchPattern) {
      baseCode = await this.prisma.code.findFirst({
        where: {
          AND: [
            { code: { startsWith: 'PL/', mode: 'insensitive' } },
            { code: { contains: searchPattern, mode: 'insensitive' } },
          ],
        },
      });
    }

    if (!baseCode) {
      throw new NotFoundException({
        statusCode: 404,
        message: `Code not found: ${codeInput}`,
        error: 'Not Found',
      });
    }

    // Normalize base response (what frontend expects)
    const baseResponse = {
      id: Number(baseCode.id),
      code: baseCode.code,
      razon_social: baseCode.razon_social ?? null,
      estado: baseCode.estado ?? null,
      municipio: baseCode.municipio ?? null,
      direccion: baseCode.direccion ?? null,
      lat: baseCode.lat ?? null,
      lon: baseCode.lon ?? null,
      grupo_id: baseCode.grupo_id ?? null,
      encargado_actual: baseCode.encargado_actual ?? null,
      baja: Boolean(baseCode.baja),
    };

    // 4) If base doesn't have lat/lon, try to geocode it first (OBJETIVO B.4)
    if (!baseCode.lat || !baseCode.lon) {
      // Attempt to geocode the base code if GeocodingService is available
      const hasGeocodingKey = Boolean(process.env.GEOCODING_API_KEY);
      
      if (hasGeocodingKey && baseCode.direccion && baseCode.municipio && baseCode.estado) {
        try {
          // Try to geocode the base code
          const addressToGeocode = `${baseCode.direccion}, ${baseCode.municipio}, ${baseCode.estado}, Mexico`;
          const geocodeResult = await this.geocodeByAddress(baseCode.id, addressToGeocode);
          
          if (geocodeResult.ok && geocodeResult.lat && geocodeResult.lon) {
            // Update base code with geocoded coordinates
            baseCode.lat = geocodeResult.lat;
            baseCode.lon = geocodeResult.lon;
            baseResponse.lat = geocodeResult.lat;
            baseResponse.lon = geocodeResult.lon;
            
            this.logger.log(`Successfully geocoded base code ${baseCode.code}`);
            // Continue with the nearby search below
          } else {
            // Geocoding failed, return empty results (no 500)
            this.logger.warn(`Failed to geocode base code ${baseCode.code}: ${geocodeResult.status}`);
            return {
              base: baseResponse,
              radiusKm,
              count: 0,
              nearby: [],
              bajasMunicipio: [],
              bajasEstado: [],
              bajasRadio: [],
            };
          }
        } catch (error) {
          // Geocoding threw an error, return empty results (no 500)
          this.logger.error(`Error geocoding base code ${baseCode.code}: ${error.message}`);
          return {
            base: baseResponse,
            radiusKm,
            count: 0,
            nearby: [],
            bajasMunicipio: [],
            bajasEstado: [],
            bajasRadio: [],
          };
        }
      } else {
        // No geocoding available or insufficient address data, return empty results (no 500)
        return {
          base: baseResponse,
          radiusKm,
          count: 0,
          nearby: [],
          bajasMunicipio: [],
          bajasEstado: [],
          bajasRadio: [],
        };
      }
    }

    // 5) Calculate bounding box
    const latDelta = radiusKm / KM_PER_DEGREE_LAT;
    const lonDelta = radiusKm / (KM_PER_DEGREE_LAT * Math.cos(this.toRad(baseCode.lat)));

    // ✅ OBJETIVO B.5: Filtro de BAJAS en nearby (comentario clave: decisión de firma)
    // Si includeBajas=false: excluir baja=true de nearby
    // Si includeBajas=true: incluir tanto baja=true como baja=false
    const bajaFilter = includeBajas ? {} : { baja: false };

    // Get candidates within bounding box
    const allCodes = await this.prisma.code.findMany({
      where: {
        lat: {
          not: null,
          gte: baseCode.lat - latDelta,
          lte: baseCode.lat + latDelta,
        },
        lon: {
          not: null,
          gte: baseCode.lon - lonDelta,
          lte: baseCode.lon + lonDelta,
        },
        id: { not: baseCode.id },
        ...bajaFilter,
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
      },
    });

    const nearby = allCodes
      .map((c) => {
        const distanceKm = this.calculateDistance(
          baseCode.lat!,
          baseCode.lon!,
          c.lat!,
          c.lon!,
        );

        return {
          id: Number(c.id),
          code: c.code,
          razon_social: c.razon_social,
          estado: c.estado,
          municipio: c.municipio,
          direccion: c.direccion,
          lat: c.lat,
          lon: c.lon,
          grupo_id: c.grupo_id,
          encargado_actual: c.encargado_actual,
          baja: c.baja ?? false,
          distanceKm: Math.round(distanceKm * 100) / 100,
        };
      })
      .filter((c) => c.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 250); // OBJETIVO B.5: Limit to max 250 results after filtering/sorting for map performance

 // ✅ OBJETIVO B.6: BAJAS por municipio (CON distancia), opcional y robusto
// Solo incluir BAJAS con lat/lon NOT NULL para que se puedan pintar en el mapa
let bajasMunicipioList: any[] = [];

if (bajasMunicipio) {
  const baseMunicipio = (baseCode.municipio || '').trim();
  const baseEstado = (baseCode.estado || '').trim();

  if (baseMunicipio && baseEstado) {
    // Intentar unaccent (si existe extensión). Si no existe, hacemos fallback.
    const muni = baseMunicipio;
    const edo = baseEstado;

    try {
      // ⚠️ Nota: si no tienes unaccent instalado, este query va a fallar y caerá al catch.
      const rows = await this.prisma.$queryRaw<any[]>`
        SELECT
          id, code, razon_social, estado, municipio, direccion, lat, lon, grupo_id, encargado_actual, baja
        FROM "codes"
        WHERE
          baja = true
          AND lat IS NOT NULL
          AND lon IS NOT NULL
          AND id <> ${baseCode.id}
          AND unaccent(lower(estado)) = unaccent(lower(${edo}))
          AND (
            unaccent(lower(municipio)) = unaccent(lower(${muni}))
            OR unaccent(lower(municipio)) LIKE '%' || unaccent(lower(${muni})) || '%'
            OR unaccent(lower(${muni})) LIKE '%' || unaccent(lower(municipio)) || '%'
          )
        ORDER BY id ASC
        LIMIT ${bajasLimit};
      `;

      bajasMunicipioList = rows
        .filter((c) => c.lat !== null && c.lon !== null)
        .map((c) => {
          const distanceKm = this.calculateDistance(
            baseCode.lat!,
            baseCode.lon!,
            c.lat!,
            c.lon!,
          );
          return {
            id: Number(c.id),
            code: c.code,
            razon_social: c.razon_social,
            estado: c.estado,
            municipio: c.municipio,
            direccion: c.direccion,
            lat: c.lat,
            lon: c.lon,
            grupo_id: c.grupo_id,
            encargado_actual: c.encargado_actual,
            baja: c.baja ?? true,
            distanceKm: Math.round(distanceKm * 100) / 100,
          };
        }).sort((a, b) => a.distanceKm - b.distanceKm);
    } catch (err) {
      // Fallback sin unaccent (menos perfecto, pero nunca rompe)
      const rows = await this.prisma.$queryRaw<any[]>`
        SELECT
          id, code, razon_social, estado, municipio, direccion, lat, lon, grupo_id, encargado_actual, baja
        FROM "codes"
        WHERE
          baja = true
          AND lat IS NOT NULL
          AND lon IS NOT NULL
          AND id <> ${baseCode.id}
          AND lower(estado) = lower(${edo})
          AND (
            lower(municipio) = lower(${muni})
            OR lower(municipio) LIKE '%' || lower(${muni}) || '%'
            OR lower(${muni}) LIKE '%' || lower(municipio) || '%'
          )
        ORDER BY id ASC
        LIMIT ${bajasLimit};
      `;

      bajasMunicipioList = rows
        .filter((c) => c.lat !== null && c.lon !== null)
        .map((c) => {
          const distanceKm = this.calculateDistance(
            baseCode.lat!,
            baseCode.lon!,
            c.lat!,
            c.lon!,
          );
          return {
            id: Number(c.id),
            code: c.code,
            razon_social: c.razon_social,
            estado: c.estado,
            municipio: c.municipio,
            direccion: c.direccion,
            lat: c.lat,
            lon: c.lon,
            grupo_id: c.grupo_id,
            encargado_actual: c.encargado_actual,
            baja: c.baja ?? true,
            distanceKm: Math.round(distanceKm * 100) / 100,
          };
        }).sort((a, b) => a.distanceKm - b.distanceKm);
    }
  }
}

// ✅ OBJETIVO B.6: BAJAS por estado (CON distancia), opcional y robusto
// Solo incluir BAJAS con lat/lon NOT NULL para poder pintarlas en el mapa
let bajasEstadoList: any[] = [];

if (bajasEstado) {
  const baseEstado = (baseCode.estado || '').trim();

  if (baseEstado) {
    try {
      // Intentar con unaccent (si existe extensión)
      const rows = await this.prisma.$queryRaw<any[]>`
        SELECT
          id, code, razon_social, estado, municipio, direccion, lat, lon, grupo_id, encargado_actual, baja
        FROM "codes"
        WHERE
          baja = true
          AND lat IS NOT NULL
          AND lon IS NOT NULL
          AND id <> ${baseCode.id}
          AND unaccent(lower(estado)) = unaccent(lower(${baseEstado}))
        ORDER BY id ASC
        LIMIT ${bajasLimit};
      `;

      bajasEstadoList = rows
        .filter((c) => c.lat !== null && c.lon !== null)
        .map((c) => {
          const distanceKm = this.calculateDistance(
            baseCode.lat!,
            baseCode.lon!,
            c.lat!,
            c.lon!,
          );
          return {
            id: Number(c.id),
            code: c.code,
            razon_social: c.razon_social,
            estado: c.estado,
            municipio: c.municipio,
            direccion: c.direccion,
            lat: c.lat,
            lon: c.lon,
            grupo_id: c.grupo_id,
            encargado_actual: c.encargado_actual,
            baja: c.baja ?? true,
            distanceKm: Math.round(distanceKm * 100) / 100,
          };
        }).sort((a, b) => a.distanceKm - b.distanceKm);
    } catch (err) {
      // Fallback sin unaccent (menos perfecto, pero nunca rompe)
      try {
        const rows = await this.prisma.$queryRaw<any[]>`
          SELECT
            id, code, razon_social, estado, municipio, direccion, lat, lon, grupo_id, encargado_actual, baja
          FROM "codes"
          WHERE
            baja = true
            AND lat IS NOT NULL
            AND lon IS NOT NULL
            AND id <> ${baseCode.id}
            AND lower(estado) = lower(${baseEstado})
          ORDER BY id ASC
          LIMIT ${bajasLimit};
        `;

        bajasEstadoList = rows
          .filter((c) => c.lat !== null && c.lon !== null)
          .map((c) => {
            const distanceKm = this.calculateDistance(
              baseCode.lat!,
              baseCode.lon!,
              c.lat!,
              c.lon!,
            );
            return {
              id: Number(c.id),
              code: c.code,
              razon_social: c.razon_social,
              estado: c.estado,
              municipio: c.municipio,
              direccion: c.direccion,
              lat: c.lat,
              lon: c.lon,
              grupo_id: c.grupo_id,
              encargado_actual: c.encargado_actual,
              baja: c.baja ?? true,
              distanceKm: Math.round(distanceKm * 100) / 100,
            };
          }).sort((a, b) => a.distanceKm - b.distanceKm);
      } catch (fallbackErr) {
        // Si incluso el fallback falla, devolver array vacío (no lanzar 500)
        bajasEstadoList = [];
      }
    }
  }
}

// ✅ OBJETIVO B.6: BAJAS por radio (CON distancia), opcional y robusto
// Solo incluir BAJAS con lat/lon NOT NULL dentro del radio especificado
let bajasRadioList: any[] = [];

if (bajasRadioKm && baseCode.lat !== null && baseCode.lon !== null) {
  // Calcular bounding box para el radio más grande
  const radiusLatDelta = bajasRadioKm / KM_PER_DEGREE_LAT;
  const radiusLonDelta = bajasRadioKm / (KM_PER_DEGREE_LAT * Math.cos(this.toRad(baseCode.lat)));

  try {
    // Obtener candidatos dentro del bounding box grande
    const candidates = await this.prisma.code.findMany({
      where: {
        baja: true,
        lat: {
          not: null,
          gte: baseCode.lat - radiusLatDelta,
          lte: baseCode.lat + radiusLatDelta,
        },
        lon: {
          not: null,
          gte: baseCode.lon - radiusLonDelta,
          lte: baseCode.lon + radiusLonDelta,
        },
        id: { not: baseCode.id },
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
      },
    });

    // Calcular distancia y filtrar por radio
    bajasRadioList = candidates
      .filter((c) => c.lat !== null && c.lon !== null)
      .map((c) => {
        const distanceKm = this.calculateDistance(
          baseCode.lat!,
          baseCode.lon!,
          c.lat!,
          c.lon!,
        );
        return {
          id: Number(c.id),
          code: c.code,
          razon_social: c.razon_social,
          estado: c.estado,
          municipio: c.municipio,
          direccion: c.direccion,
          lat: c.lat,
          lon: c.lon,
          grupo_id: c.grupo_id,
          encargado_actual: c.encargado_actual,
          baja: c.baja ?? true,
          distanceKm: Math.round(distanceKm * 100) / 100,
        };
      })
      .filter((c) => c.distanceKm <= bajasRadioKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, bajasLimit);
  } catch (err) {
    // Si falla, devolver array vacío (no lanzar 500)
    bajasRadioList = [];
  }
}

    return {
      base: baseResponse,
      radiusKm,
      count: nearby.length,
      nearby,
      bajasMunicipio: bajasMunicipioList,
      bajasEstado: bajasEstadoList,
      bajasRadio: bajasRadioList,
    };
  } catch (error) {
    if (error instanceof NotFoundException) throw error;

    this.logger.error('ERROR finding nearby codes:', error);
    throw new InternalServerErrorException({
      statusCode: 500,
      message: 'An error occurred while searching for nearby codes. Please try again later.',
      error: 'Internal Server Error',
    });
  }
}
  // Haversine formula to calculate distance between two lat/lon points
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Batch geocode codes with missing lat/lon coordinates
   * @param limit Maximum number of codes to process (default 200)
   * @param startId Starting ID for pagination (default 0)
   * @returns Statistics about the batch geocoding process
   */
  async geocodeMissing(
  limit: number = 200,
  startId: bigint = BigInt(0),
  includeBajas: boolean = false, // OBJETIVO C.7: includeBajas query parameter
): Promise<GeocodeMissingResponse> {
    const startTime = Date.now();
    
    // Validate limit
    const actualLimit = Math.min(Math.max(1, limit), 1000); // Cap at 1000 for safety
    
    // OBJETIVO C.7: Find codes that need geocoding with includeBajas filter
    // Por default: includeBajas=false (comportamiento actual, excluye baja=true)
    // Si includeBajas=true: incluir también BAJAS en el batch
    const codes = await this.prisma.code.findMany({
      where: {
        AND: [
          { id: { gt: startId } },
          {
            OR: [{ lat: null }, { lon: null }],
          },
          ...(includeBajas ? [] : [{ baja: { not: true } }]),
          { estado: { not: '' } },
          { estado: { not: null } },
        ],
      },
      select: {
        id: true,
        code: true,
        direccion: true,
        municipio: true,
        estado: true,
        lat: true,
        lon: true,
      },
      orderBy: {
        id: 'asc',
      },
      take: actualLimit,
    });

    let processed = 0;
    let updated = 0;
    let failed = 0;
    let retried = 0;
    let overLimitCount = 0;
    const sampleUpdated: GeocodeResult[] = [];
    const sampleFailed: GeocodeResult[] = [];
    let lastIdProcessed: bigint | null = null;
    
    // OBJETIVO C.8: Reduce concurrency from 20 to 3 for stability
    const CONCURRENCY = 3;
    const BATCH_DELAY_MS = 200; // 200ms delay between batches (with CONCURRENCY=3, effective ~15 req/sec with backoff handling 429s)
    
    type CodeRecord = typeof codes[0];
    const batches: CodeRecord[][] = [];
    
    // Split codes into batches for concurrent processing
    for (let i = 0; i < codes.length; i += CONCURRENCY) {
      batches.push(codes.slice(i, i + CONCURRENCY));
    }

    // Process each batch
    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map(code => this.geocodeWithFallback(code))
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const code = batch[i];
        processed++;
        lastIdProcessed = code.id;

        if (result.status === 'fulfilled') {
          const geocodeResult = result.value;
          
          if (geocodeResult.retries > 0) {
            retried++;
          }
          if (geocodeResult.overLimit) {
            overLimitCount++;
          }

          if (geocodeResult.success) {
            updated++;
            if (sampleUpdated.length < 10) {
              sampleUpdated.push({
                code: code.code,
                status: 'updated',
                lat: geocodeResult.lat,
                lon: geocodeResult.lon,
                address: geocodeResult.addressUsed || `${code.direccion}, ${code.municipio}, ${code.estado}`,
              });
            }
          } else {
            failed++;
            if (sampleFailed.length < 10) {
              sampleFailed.push({
                code: code.code,
                status: 'failed',
                reason: geocodeResult.reason || 'unknown',
                address: geocodeResult.addressUsed || `${code.direccion}, ${code.municipio}, ${code.estado}`,
              });
            }
          }
        } else {
          // Promise rejected (unexpected error)
          failed++;
          this.logger.error(`Unexpected error processing code ${code.code}: ${result.reason}`);
          if (sampleFailed.length < 10) {
            sampleFailed.push({
              code: code.code,
              status: 'failed',
              reason: 'exception',
              error: result.reason?.message || String(result.reason),
              address: `${code.direccion}, ${code.municipio}, ${code.estado}`,
            });
          }
        }
      }
      
      // OBJETIVO C.8: Add delay between batches for rate limiting (effective ~15 req/sec with backoff handling 429s)
      // Skip delay after the last batch
      if (processed < codes.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    const elapsedMs = Date.now() - startTime;

    return {
      processed,
      updated,
      failed,
      retried,
      overLimitCount,
      lastIdProcessed,
      elapsedMs,
      sampleUpdated,
      sampleFailed,
    };
  }

  /**
   * Geocode a single code with address fallback and retry logic
   * OBJETIVO C.8: Handles 429/OVER_QUERY_LIMIT with exponential backoff
   * Captures REQUEST_DENIED / invalid key as failed, not exception
   * Tries 3 address formats in order:
   * 1. direccion + municipio + estado + Mexico
   * 2. municipio + estado + Mexico
   * 3. estado + Mexico
   */
  private async geocodeWithFallback(code: {
    id: bigint;
    code: string;
    direccion: string | null;
    municipio: string | null;
    estado: string | null;
  }): Promise<{
    success: boolean;
    lat?: number;
    lon?: number;
    reason?: string;
    addressUsed?: string;
    retries: number;
    overLimit: boolean;
  }> {
    const MAX_RETRIES = 5;
    const BACKOFF_MS = [500, 1000, 2000, 4000, 8000]; // 500ms, 1s, 2s, 4s, 8s
    
    // Build address fallback options
    const addressOptions: string[] = [];
    
    // Option A: Full address
    if (code.direccion && code.municipio && code.estado) {
      addressOptions.push(`${code.direccion}, ${code.municipio}, ${code.estado}, Mexico`);
    }
    
    // Option B: Municipio + Estado
    if (code.municipio && code.estado) {
      addressOptions.push(`${code.municipio}, ${code.estado}, Mexico`);
    }
    
    // Option C: Estado only
    if (code.estado) {
      addressOptions.push(`${code.estado}, Mexico`);
    }
    
    if (addressOptions.length === 0) {
      return { success: false, reason: 'no_address', retries: 0, overLimit: false };
    }

    let totalRetries = 0;
    let overLimit = false;

    // Try each address option
    for (const address of addressOptions) {
      let retries = 0;
      
      while (retries < MAX_RETRIES) {
        try {
          const result = await this.geocodeByAddress(code.id, address);
          
          // Handle fatal API errors that shouldn't retry
          if (result.status === 'REQUEST_DENIED' || result.status === 'INVALID_REQUEST') {
            this.logger.error(`API error for code ${code.code}: ${result.status}`);
            return {
              success: false,
              reason: result.status === 'REQUEST_DENIED' ? 'request_denied' : 'invalid_request',
              retries: totalRetries,
              overLimit: false,
            };
          }
          
          if (result.status === 'OVER_QUERY_LIMIT') {
            overLimit = true;
            retries++;
            totalRetries++;
            
            if (retries < MAX_RETRIES) {
              // Use retries-1 as index: retry 1 → 500ms, retry 2 → 1s, etc.
              const backoffMs = BACKOFF_MS[Math.min(retries - 1, BACKOFF_MS.length - 1)];
              this.logger.warn(`Rate limit hit for code ${code.code}, retry ${retries}/${MAX_RETRIES} after ${backoffMs}ms`);
              await new Promise(resolve => setTimeout(resolve, backoffMs));
              continue;
            } else {
              // Exceeded retries for this address, try next fallback
              this.logger.warn(`Rate limit exceeded for code ${code.code} with address: ${address}`);
              break;
            }
          }
          
          if (result.ok && result.lat && result.lon) {
            return {
              success: true,
              lat: result.lat,
              lon: result.lon,
              addressUsed: address,
              retries: totalRetries,
              overLimit,
            };
          } else {
            // This address didn't work, try next fallback
            break;
          }
        } catch (error) {
          retries++;
          totalRetries++;
          
          if (retries < MAX_RETRIES) {
            // Use retries-1 as index: retry 1 → 500ms, retry 2 → 1s, etc.
            const backoffMs = BACKOFF_MS[Math.min(retries - 1, BACKOFF_MS.length - 1)];
            this.logger.warn(`Error geocoding code ${code.code}: ${error.message}, retry ${retries}/${MAX_RETRIES}`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          } else {
            // Try next address fallback
            break;
          }
        }
      }
    }

    // All address options failed
    return {
      success: false,
      reason: overLimit ? 'rate_limit_exceeded' : 'geocoding_failed',
      retries: totalRetries,
      overLimit,
    };
  }

  /**
   * Geocode using a specific address string
   */
private async geocodeByAddress(
  codeId: bigint,
  address: string,
): Promise<{ ok: boolean; lat?: number; lon?: number; status?: string }> {
  // ✅ Siempre definido en este scope
  const address_hash = crypto.createHash('sha256').update(address).digest('hex');

  // Cache primero
  const cached = await this.prisma.geocodeCache.findUnique({ where: { address_hash } });
  if (cached?.status === 'OK' && cached.lat != null && cached.lon != null) {
    await this.prisma.code.update({
      where: { id: codeId },
      data: {
        lat: cached.lat,
        lon: cached.lon,
        formatted_address: cached.formatted_address || null,
      },
    });
    return { ok: true, lat: cached.lat, lon: cached.lon, status: 'OK' };
  }

  const key = process.env.GEOCODING_API_KEY;
  if (!key) {
    // fallback OSM
    return this.geocodeWithNominatim(codeId, address, address_hash);
  }

  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?address=${encodeURIComponent(address)}` +
      `&components=country:MX&region=mx&language=es&key=${key}`;

    const resp = await fetch(url);
    const json: any = await resp.json();
    const status: string = json?.status || 'ERROR';

    if (status === 'OK' && json?.results?.length) {
      const r = json.results[0];
      const lat = r.geometry.location.lat;
      const lon = r.geometry.location.lng;
      const place_id = r.place_id ?? null;
      const formatted_address = r.formatted_address ?? null;

      await this.prisma.$transaction([
        this.prisma.geocodeCache.upsert({
          where: { address_hash },
          create: {
            address_hash,
            address_str: address,
            lat,
            lon,
            place_id,
            formatted_address,
            status: 'OK',
            provider: 'google',
          },
          update: {
            lat,
            lon,
            place_id,
            formatted_address,
            status: 'OK',
            provider: 'google',
            refreshed_at: new Date(),
          },
        }),
        this.prisma.code.update({
          where: { id: codeId },
          data: { lat, lon, formatted_address },
        }),
      ]);

      return { ok: true, lat, lon, status: 'OK' };
    }

    // cachea fallos también
    await this.prisma.geocodeCache.upsert({
      where: { address_hash },
      create: { address_hash, address_str: address, status, provider: 'google' },
      update: { status, provider: 'google', refreshed_at: new Date() },
    });

    return { ok: false, status };
  } catch (error: any) {
    this.logger.error(`Google Geocoding error: ${error?.message || error}`);
    return { ok: false, status: 'ERROR' };
  }
}
  /**
   * Geocode using Nominatim (OpenStreetMap) as fallback
   */
private async geocodeWithNominatim(
  codeId: bigint,
  address: string,
  address_hash: string,
): Promise<{ ok: boolean; lat?: number; lon?: number; status?: string }> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(address)}` +
      `&format=json&limit=1&countrycodes=mx`;

    const resp = await fetch(url, {
      headers: {
        'User-Agent': `CodesBackend/1.0 (contact: ${process.env.CONTACT_EMAIL || 'admin@example.com'})`,
      },
    });

    if (!resp.ok) {
      const status = `HTTP_${resp.status}`;
      await this.prisma.geocodeCache.upsert({
        where: { address_hash },
        create: { address_hash, address_str: address, status, provider: 'nominatim' },
        update: { status, provider: 'nominatim', refreshed_at: new Date() },
      });
      return { ok: false, status };
    }

    const results: any[] = await resp.json();
    if (Array.isArray(results) && results.length > 0) {
      const r = results[0];
      const lat = parseFloat(r.lat);
      const lon = parseFloat(r.lon);
      const formatted_address = r.display_name ?? null;

      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        await this.prisma.$transaction([
          this.prisma.geocodeCache.upsert({
            where: { address_hash },
            create: {
              address_hash,
              address_str: address,
              lat,
              lon,
              formatted_address,
              status: 'OK',
              provider: 'nominatim',
            },
            update: {
              lat,
              lon,
              formatted_address,
              status: 'OK',
              provider: 'nominatim',
              refreshed_at: new Date(),
            },
          }),
          this.prisma.code.update({
            where: { id: codeId },
            data: { lat, lon, formatted_address },
          }),
        ]);

        return { ok: true, lat, lon, status: 'OK' };
      }
    }

    await this.prisma.geocodeCache.upsert({
      where: { address_hash },
      create: { address_hash, address_str: address, status: 'ZERO_RESULTS', provider: 'nominatim' },
      update: { status: 'ZERO_RESULTS', provider: 'nominatim', refreshed_at: new Date() },
    });

    return { ok: false, status: 'ZERO_RESULTS' };
  } catch (error: any) {
    this.logger.error(`Nominatim error: ${error?.message || error}`);
    return { ok: false, status: 'ERROR' };
  }
}

  /**
   * Geocode retry for codes with valid estado and municipio but missing lat/lon
   * Uses a different strategy than geocodeMissing:
   * 1. municipio + estado + Mexico
   * 2. municipio + Mexico
   * 3. estado + Mexico
   * 
   * Rate limit: 5 requests per second
   */
  async geocodeRetry(
  limit: number = 500,
  includeBajas: boolean = false,
): Promise<{
  ok: boolean;
  processed: number;
  updated: number;
  failed: number;
  sampleUpdated: GeocodeResult[];
  sampleFailed: GeocodeResult[];
}> {
    try {
      // Validate limit
      const actualLimit = Math.min(Math.max(1, limit), 1000);
      
      // Check if API key is present
      const key = process.env.GEOCODING_API_KEY;
      if (!key) {
        return {
          ok: false,
          processed: 0,
          updated: 0,
          failed: 0,
          sampleUpdated: [],
          sampleFailed: [{
            code: 'N/A',
            status: 'failed',
            reason: 'GEOCODING_API_KEY not configured',
            address: 'N/A',
          }],
        };
      }

      // Find codes that need geocoding with specific filters
      const codes = await this.prisma.code.findMany({
        where: {
  AND: [
    {
      OR: [{ lat: null }, { lon: null }],
    },
    ...(includeBajas ? [] : [{ baja: { not: true } }]),
    { estado: { not: '' } },
    { municipio: { not: '' } },
  ],
},
        select: {
          id: true,
          code: true,
          municipio: true,
          estado: true,
          lat: true,
          lon: true,
        },
        orderBy: {
          id: 'asc',
        },
        take: actualLimit,
      });

      let processed = 0;
      let updated = 0;
      let failed = 0;
      const sampleUpdated: GeocodeResult[] = [];
      const sampleFailed: GeocodeResult[] = [];

      // Rate limit: 5 requests per second = 200ms between requests
      const RATE_LIMIT_MS = 200;

      // Process codes sequentially with rate limiting
      for (const code of codes) {
        processed++;

        try {
          const result = await this.geocodeRetryStrategies(code);

          if (result.success) {
            updated++;
            if (sampleUpdated.length < 10) {
              sampleUpdated.push({
                code: code.code,
                status: 'updated',
                lat: result.lat,
                lon: result.lon,
                address: result.addressUsed || `${code.municipio}, ${code.estado}`,
              });
            }
          } else {
            failed++;
            if (sampleFailed.length < 10) {
              sampleFailed.push({
                code: code.code,
                status: 'failed',
                reason: result.reason || 'unknown',
                address: result.addressUsed || `${code.municipio}, ${code.estado}`,
              });
            }
          }

          // Rate limiting: wait 200ms between requests (5 req/sec)
          if (processed < codes.length) {
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
          }
        } catch (error) {
          // Catch unexpected errors
          failed++;
          this.logger.error(`Unexpected error processing code ${code.code}: ${error.message}`);
          if (sampleFailed.length < 10) {
            sampleFailed.push({
              code: code.code,
              status: 'failed',
              reason: 'exception',
              error: error.message || String(error),
              address: `${code.municipio}, ${code.estado}`,
            });
          }
        }
      }

      return {
        ok: true,
        processed,
        updated,
        failed,
        sampleUpdated,
        sampleFailed,
      };
    } catch (error) {
      // Top-level error handling
      this.logger.error(`geocodeRetry error: ${error.message}`);
      return {
        ok: false,
        processed: 0,
        updated: 0,
        failed: 0,
        sampleUpdated: [],
        sampleFailed: [{
          code: 'N/A',
          status: 'failed',
          reason: 'exception',
          error: error.message || String(error),
          address: 'N/A',
        }],
      };
    }
  }

  /**
   * Try geocoding with 3 strategies for retry batch:
   * 1. municipio + estado + Mexico
   * 2. municipio + Mexico
   * 3. estado + Mexico
   */
  private async geocodeRetryStrategies(code: {
    id: bigint;
    code: string;
    municipio: string | null;
    estado: string | null;
  }): Promise<{
    success: boolean;
    lat?: number;
    lon?: number;
    reason?: string;
    addressUsed?: string;
  }> {
    // Build address strategies
    const strategies: string[] = [];
    
    // Strategy 1: municipio + estado + Mexico
    if (code.municipio && code.estado) {
      strategies.push(`${code.municipio}, ${code.estado}, Mexico`);
    }
    
    // Strategy 2: municipio + Mexico
    if (code.municipio) {
      strategies.push(`${code.municipio}, Mexico`);
    }
    
    // Strategy 3: estado + Mexico
    if (code.estado) {
      strategies.push(`${code.estado}, Mexico`);
    }
    
    if (strategies.length === 0) {
      return { success: false, reason: 'no_address' };
    }

    // Try each strategy in order
    for (const address of strategies) {
      try {
        const result = await this.geocodeRetryByAddress(code.id, address);
        
        // Handle specific error cases
        if (result.status === 'REQUEST_DENIED') {
          return {
            success: false,
            reason: 'request_denied',
            addressUsed: address,
          };
        }
        
        if (result.status === 'ZERO_RESULTS') {
          // This strategy didn't work, try next one
          continue;
        }
        
        if (result.ok && result.lat && result.lon) {
          return {
            success: true,
            lat: result.lat,
            lon: result.lon,
            addressUsed: address,
          };
        }
      } catch (error) {
        // Log error but continue to next strategy
        this.logger.warn(`Error geocoding code ${code.code} with strategy "${address}": ${error.message}`);
      }
    }

    // All strategies failed
    return {
      success: false,
      reason: 'all_strategies_failed',
    };
  }

  /**
   * Geocode using a specific address string for retry batch
   */
 private async geocodeRetryByAddress(
  codeId: bigint,
  address: string,
): Promise<{ ok: boolean; lat?: number; lon?: number; status?: string }> {
  // ✅ Siempre definido
  const address_hash = crypto.createHash('sha256').update(address).digest('hex');

  const cached = await this.prisma.geocodeCache.findUnique({ where: { address_hash } });
  if (cached?.status === 'OK' && cached.lat != null && cached.lon != null) {
    await this.prisma.code.update({
      where: { id: codeId },
      data: {
        lat: cached.lat,
        lon: cached.lon,
        formatted_address: cached.formatted_address || null,
      },
    });
    return { ok: true, lat: cached.lat, lon: cached.lon, status: 'OK' };
  }

  const key = process.env.GEOCODING_API_KEY;
  if (!key) return { ok: false, status: 'NO_API_KEY' };

  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?address=${encodeURIComponent(address)}` +
      `&components=country:MX&region=mx&language=es&key=${key}`;

    const resp = await fetch(url);
    const json: any = await resp.json();
    const status: string = json?.status || 'ERROR';

    if (status === 'OK' && json?.results?.length) {
      const r = json.results[0];
      const lat = r.geometry.location.lat;
      const lon = r.geometry.location.lng;
      const place_id = r.place_id ?? null;
      const formatted_address = r.formatted_address ?? null;

      await this.prisma.$transaction([
        this.prisma.geocodeCache.upsert({
          where: { address_hash },
          create: {
            address_hash,
            address_str: address,
            lat,
            lon,
            place_id,
            formatted_address,
            status: 'OK',
            provider: 'google',
          },
          update: {
            lat,
            lon,
            place_id,
            formatted_address,
            status: 'OK',
            provider: 'google',
            refreshed_at: new Date(),
          },
        }),
        this.prisma.code.update({
          where: { id: codeId },
          data: { lat, lon, formatted_address },
        }),
      ]);

      return { ok: true, lat, lon, status: 'OK' };
    }

    await this.prisma.geocodeCache.upsert({
      where: { address_hash },
      create: { address_hash, address_str: address, status, provider: 'google' },
      update: { status, provider: 'google', refreshed_at: new Date() },
    });

    return { ok: false, status };
  } catch (error: any) {
    this.logger.error(`Google retry geocode error: ${error?.message || error}`);
    return { ok: false, status: 'ERROR' };
  }
}
}
