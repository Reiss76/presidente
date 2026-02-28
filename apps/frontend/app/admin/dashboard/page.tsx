'use client';

import React, { useEffect, useMemo, useState } from 'react';
import AppHeader from '../../../components/AppHeader';
import { getApiBase } from '../../../lib/api';

const API = getApiBase();
const DASHBOARD_CATALOGS_ENDPOINT = `${API}/codes/tools/dashboard/catalogs`;
const DASHBOARD_RESULTS_ENDPOINT = `${API}/codes/tools/dashboard/results`;
const DASHBOARD_EXPORT_ENDPOINT = `${API}/codes/tools/dashboard/export.csv`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function readBody(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      return await res.json();
    } catch {
      return { message: 'Respuesta inválida' };
    }
  }
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeNumberMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  Object.entries(value).forEach(([k, v]) => {
    out[k] = toNumber(v, 0);
  });
  return out;
}

type FilterOption = { value: string; label: string };
type DashboardResultItem = Record<string, unknown>;

type DashboardFilters = {
  user?: string;
  sub?: string;
  estado?: string;
  municipio?: string;
  grupo?: string;
  calibracion?: string;
  m13?: string;
  baja?: string;
  visitType?: string;
  from?: string;
  to?: string;
  q?: string;
};

type DashboardFilterOptions = {
  user: FilterOption[];
  sub: FilterOption[];
  estado: FilterOption[];
  municipio: FilterOption[];
  grupo: FilterOption[];
  calibracion: FilterOption[];
  m13: FilterOption[];
  baja: FilterOption[];
  visitType: FilterOption[];
};

const YES_NO_OPTIONS: FilterOption[] = [
  { value: 'true', label: 'Sí' },
  { value: 'false', label: 'No' },
];

const DEFAULT_VISIT_TYPES: FilterOption[] = [
  { value: 'verificacion', label: 'Verificación' },
  { value: 'calibracion', label: 'Calibración' },
  { value: 'supervision', label: 'Supervisión' },
  { value: 'cateo', label: 'Cateo' },
];

const DEFAULT_CALIBRATION_OPTIONS: FilterOption[] = [
  { value: 'S', label: 'Solicitada' },
  { value: 'R', label: 'Realizada' },
];

const EMPTY_FILTER_OPTIONS: DashboardFilterOptions = {
  user: [],
  sub: [],
  estado: [],
  municipio: [],
  grupo: [],
  calibracion: DEFAULT_CALIBRATION_OPTIONS,
  m13: YES_NO_OPTIONS,
  baja: YES_NO_OPTIONS,
  visitType: DEFAULT_VISIT_TYPES,
};

const INITIAL_FILTERS: DashboardFilters = {
  user: '',
  sub: '',
  estado: '',
  municipio: '',
  grupo: '',
  calibracion: '',
  m13: '',
  baja: '',
  visitType: '',
  from: '',
  to: '',
  q: '',
};

function toOptionList(source: unknown, fallback: FilterOption[] = []): FilterOption[] {
  const options: FilterOption[] = [];
  const seen = new Set<string>();

  const pushOption = (value: unknown, label?: unknown) => {
    if (value == null) return;
    const strValue = String(value);
    if (!strValue.trim() || seen.has(strValue)) return;
    seen.add(strValue);
    options.push({ value: strValue, label: String(label ?? strValue) });
  };

  if (Array.isArray(source)) {
    source.forEach((item, idx) => {
      if (typeof item === 'string' || typeof item === 'number') {
        pushOption(item, item);
      } else if (isRecord(item)) {
        const val = item.value ?? item.id ?? item.slug ?? item.key ?? idx;
        const label = item.label ?? item.name ?? item.title ?? val;
        pushOption(val, label);
      }
    });
  } else if (isRecord(source)) {
    Object.entries(source).forEach(([k, v]) => pushOption(k, v));
  }

  if (options.length === 0) return [...fallback];
  return options;
}

function normalizeFilterOptions(raw: unknown): DashboardFilterOptions {
  const container = isRecord(raw) ? raw : {};
  const source = (isRecord((container as any).items) ? (container as any).items : container) as Record<string, unknown>;

  // Helper: intenta múltiples claves posibles para el mismo catálogo
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      const v = (source as any)[k];
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  };

  // Muchísimos backends nombran distinto; aquí cubrimos variantes comunes
  const usersSrc = pick('user', 'users', 'usuarios', 'encargado_actual', 'encargados', 'encargado');
  const subsSrc = pick('sub', 'subs', 'subusuarios', 'sub_usuarios', 'encargado_anterior', 'subEncargados', 'sub_encargados');

  const estadosSrc = pick('estado', 'estados', 'states');
  const municipiosSrc = pick('municipio', 'municipios', 'cities', 'city');

  // 🔥 ESTE ES EL IMPORTANTE: Grupo
  // puede venir como: grupo, grupos, group, groups, porGrupoLabel, groupLabels, catalogGroups, etc.
  const gruposSrc = pick(
    'grupo',
    'grupos',
    'group',
    'groups',
    'catalogGroups',
    'catalog_groups',
    'groupLabels',
    'byGroupLabel',
    'porGrupoLabel',
    'porGrupo',
    'byGroup',
    'by_group'
  );

  const calibracionSrc = pick('calibracion', 'calibraciones', 'calibration');
  const m13Src = pick('m13');
  const bajaSrc = pick('baja');
  const visitTypeSrc = pick('visitType', 'visit_type', 'visitsType', 'tipoVisita', 'tipo_visita', 'visitTypes', 'types');

  return {
    user: toOptionList(usersSrc, EMPTY_FILTER_OPTIONS.user),
    sub: toOptionList(subsSrc, EMPTY_FILTER_OPTIONS.sub),
    estado: toOptionList(estadosSrc, EMPTY_FILTER_OPTIONS.estado),
    municipio: toOptionList(municipiosSrc, EMPTY_FILTER_OPTIONS.municipio),

    // ✅ Si gruposSrc viene como mapa { "1": "Gr-2000", ... } lo convierte en options.
    // ✅ Si viene como array [{id,name}] también.
    grupo: toOptionList(gruposSrc, EMPTY_FILTER_OPTIONS.grupo),

    calibracion: toOptionList(calibracionSrc, DEFAULT_CALIBRATION_OPTIONS),
    m13: toOptionList(m13Src, YES_NO_OPTIONS),
    baja: toOptionList(bajaSrc, YES_NO_OPTIONS),
    visitType: toOptionList(visitTypeSrc, DEFAULT_VISIT_TYPES),
  };
}
function buildQueryString(filters: DashboardFilters): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    const strValue = typeof value === 'string' ? value.trim() : String(value);
    if (strValue !== '') params.append(key, strValue);
  });
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function hasFilters(filters: DashboardFilters): boolean {
  return Object.values(filters).some((value) => {
    if (value === undefined || value === null) return false;
    const str = typeof value === 'string' ? value.trim() : String(value);
    return str !== '';
  });
}

type MetricsData = {
  codes?: {
    total: number;
    byGroup: Record<string, number>;
    m13Count: number;
    assignedCount: number;
    calSolicitadas: number;
    calRealizadas: number;
    byGroupLabel?: Record<string, string>;
  };
  visits?: {
    monthCount: number;
    last10: Array<{
      id: number;
      code: string;
      visit_date: string;
      visit_type: string;
    }>;
    byType: Record<string, number>;
  };
  comments?: Array<{
    id: number;
    code: string;
    comentario: string;
    created_at: string;
    actor_username?: string;
  }>;
};

type DashboardResults = {
  metrics: MetricsData;
  items: DashboardResultItem[];
  totalRows: number;
};

const EMPTY_METRICS: MetricsData = {
  codes: { total: 0, byGroup: {}, m13Count: 0, assignedCount: 0, calSolicitadas: 0, calRealizadas: 0 },
  visits: { monthCount: 0, last10: [], byType: {} },
  comments: [],
};

function normalizeVisitsList(list: unknown): NonNullable<MetricsData['visits']>['last10'] {
  if (!Array.isArray(list)) return [];
  return list.map((v, idx) => ({
    id: toNumber((v as any)?.id ?? (v as any)?.visit_id ?? idx, idx),
    code: String((v as any)?.code ?? (v as any)?.code_id ?? '—'),
    visit_date: String((v as any)?.visit_date ?? (v as any)?.date ?? (v as any)?.created_at ?? '—'),
    visit_type: String((v as any)?.visit_type ?? (v as any)?.type ?? '—'),
  }));
}

function normalizeCodesFromDashboard(raw: unknown): NonNullable<MetricsData['codes']> {
  const wrapper = isRecord(raw) ? raw : {};
  const items = Array.isArray((wrapper as any).items) ? (wrapper as any).items : [];

  const groupSource =
    (isRecord((wrapper as any).porGrupo) && (wrapper as any).porGrupo) ||
    (isRecord((wrapper as any).byGroup) && (wrapper as any).byGroup) ||
    (isRecord((wrapper as any).by_group) && (wrapper as any).by_group) ||
    (isRecord((wrapper as any).groups) && (wrapper as any).groups) ||
    {};

  const groupLabels =
    (isRecord((wrapper as any).byGroupLabel) && (wrapper as any).byGroupLabel) ||
    (isRecord((wrapper as any).porGrupoLabel) && (wrapper as any).porGrupoLabel) ||
    (isRecord((wrapper as any).groupLabels) && (wrapper as any).groupLabels) ||
    undefined;

  const derivedGroups: Record<string, number> = {};
  items.forEach((item: any) => {
    const groupValue =
      (item as any)?.grupo ??
      (item as any)?.grupo_id ??
      (item as any)?.group ??
      (item as any)?.group_id ??
      (item as any)?.grupoId ??
      (item as any)?.groupId;

    const key = typeof groupValue === 'string' ? groupValue.trim() : groupValue != null ? String(groupValue) : '';
    if (!key) return;
    derivedGroups[key] = (derivedGroups[key] || 0) + 1;
  });

  const m13FromItems = items.reduce((acc: number, item: any) => {
    const flag = item?.m13 ?? item?.is_m13 ?? item?.m13Flag;
    return flag ? acc + 1 : acc;
  }, 0);

  const extra = isRecord((wrapper as any).extra) ? (wrapper as any).extra : {};

  return {
    total: toNumber((wrapper as any).total ?? (wrapper as any).count ?? (wrapper as any).totalCodes ?? items.length, items.length || 0),
    byGroup: normalizeNumberMap(Object.keys(groupSource).length ? groupSource : derivedGroups),
    m13Count: toNumber((wrapper as any).m13Count ?? (wrapper as any).m13 ?? m13FromItems, m13FromItems || 0),
    assignedCount: toNumber((extra as any).assignedCount ?? (wrapper as any).assignedCount, 0),
    calSolicitadas: toNumber((extra as any).calSolicitadas ?? (wrapper as any).calSolicitadas, 0),
    calRealizadas: toNumber((extra as any).calRealizadas ?? (wrapper as any).calRealizadas, 0),
    byGroupLabel: groupLabels
      ? Object.fromEntries(Object.entries(groupLabels).map(([k, v]) => [String(k), String(v)]))
      : undefined,
  };
}

function normalizeVisitsMetrics(raw: unknown): NonNullable<MetricsData['visits']> {
  const list = Array.isArray((raw as any)?.items) ? (raw as any).items : Array.isArray(raw) ? raw : [];

  const baseByType =
    (isRecord((raw as any)?.byType) && (raw as any).byType) ||
    (isRecord((raw as any)?.by_type) && (raw as any).by_type) ||
    (isRecord((raw as any)?.types) && (raw as any).types) ||
    {};

  const derivedByType: Record<string, number> = {};

  (list as Array<{ visit_type?: string; type?: string; visitType?: string }>).forEach((v) => {
    const typeValue = (v as any)?.visit_type ?? (v as any)?.type ?? (v as any)?.visitType;
    const key = typeof typeValue === 'string' ? typeValue : typeValue != null ? String(typeValue) : '—';
    const k = key || '—';
    derivedByType[k] = (derivedByType[k] || 0) + 1;
  });

  const last10 = normalizeVisitsList((list as any[]).slice(0, 10));

  return {
    monthCount: toNumber((raw as any)?.monthCount ?? (raw as any)?.count ?? (raw as any)?.total ?? list.length, list.length),
    last10,
    byType: normalizeNumberMap(Object.keys(derivedByType).length ? derivedByType : baseByType),
  };
}

function normalizeComments(raw: unknown): NonNullable<MetricsData['comments']> {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, idx) => ({
    id: toNumber((item as any)?.id ?? idx, idx),
    code: String((item as any)?.code ?? (item as any)?.code_id ?? '—'),
    comentario: String((item as any)?.comentario ?? (item as any)?.comment ?? ''),
    created_at: String((item as any)?.created_at ?? (item as any)?.createdAt ?? ''),
    actor_username: (item as any)?.actor_username ? String((item as any)?.actor_username) : undefined,
  }));
}

function normalizeDashboardQuery(raw: unknown): MetricsData {
  const container = isRecord(raw) ? raw : {};
  const data = isRecord((container as any).data) ? (container as any).data : container;

  const codesSource =
    (isRecord((data as any).dashboard) && (data as any).dashboard) ||
    (isRecord((data as any).codesDashboard) && (data as any).codesDashboard) ||
    (isRecord((data as any).codes) && (data as any).codes) ||
    (isRecord((data as any).codigos) && (data as any).codigos) ||
    data;

  const visitsSource =
    (isRecord((data as any).visitsDashboard) && (data as any).visitsDashboard) ||
    (isRecord((data as any).visits) && (data as any).visits) ||
    (isRecord((data as any).visitas) && (data as any).visitas) ||
    (Array.isArray((data as any)?.visit_list) ? { items: (data as any).visit_list } : undefined) ||
    data;

  const commentsSource =
    (Array.isArray((data as any)?.comments) && (data as any).comments) ||
    (Array.isArray((data as any)?.comentarios) && (data as any).comentarios) ||
    [];

  return {
    codes: normalizeCodesFromDashboard(codesSource),
    visits: normalizeVisitsMetrics(visitsSource),
    comments: normalizeComments(commentsSource),
  };
}

function normalizeDashboardResults(raw: unknown): DashboardResults {
  const container = isRecord(raw) ? raw : {};
  const data = isRecord((container as any).data) ? (container as any).data : container;
  const dataAny = data as Record<string, unknown>;
  const containerAny = container as Record<string, unknown>;

  const itemsFromData: DashboardResultItem[] =
    (Array.isArray(dataAny?.items) && (dataAny.items as DashboardResultItem[])) ||
    (Array.isArray(dataAny?.rows) && (dataAny.rows as DashboardResultItem[])) ||
    (Array.isArray(dataAny?.results) && (dataAny.results as DashboardResultItem[])) ||
    [];

  const directItems: DashboardResultItem[] = Array.isArray(raw)
    ? (raw as DashboardResultItem[])
    : Array.isArray(containerAny?.items)
    ? (containerAny.items as DashboardResultItem[])
    : [];

  const items = itemsFromData.length ? itemsFromData : directItems;

  const totalRows = toNumber(
    (dataAny?.totalRows as number | undefined) ??
      (dataAny?.total as number | undefined) ??
      (dataAny?.count as number | undefined) ??
      (containerAny?.totalRows as number | undefined) ??
      (containerAny?.total as number | undefined) ??
      (containerAny?.count as number | undefined) ??
      items.length,
    items.length
  );

  const metricsSource = (dataAny?.metrics as unknown) ?? (containerAny?.metrics as unknown) ?? dataAny?.dashboard ?? containerAny?.dashboard ?? data;

  return {
    metrics: normalizeDashboardQuery(metricsSource),
    items,
    totalRows,
  };
}

type AuthUser = {
  id: number;
  username: string;
  role: 'admin' | 'editor';
};

function messageFrom(body: unknown, res: Response | null): string {
  return (
    (isRecord(body) ? (body as any).message : undefined) ||
    (typeof body === 'string' ? body : null) ||
    (res ? `Error ${res.status}` : 'Error desconocido')
  );
}

async function fetchWithBody(url: string): Promise<{ res: Response | null; body: unknown }> {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' }).catch(() => null);
  const body = res ? await readBody(res) : null;
  return { res, body };
}

export default function AdminDashboardPage() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>(INITIAL_FILTERS);
  const [filtersApplied, setFiltersApplied] = useState(false);
  const [filterOptions, setFilterOptions] = useState<DashboardFilterOptions>(EMPTY_FILTER_OPTIONS);
  const [filtersLoading, setFiltersLoading] = useState(false);
  const [filtersError, setFiltersError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [rows, setRows] = useState<DashboardResultItem[]>([]);
  const [totalRows, setTotalRows] = useState(0);

  const BTN_PRIMARY = useMemo<React.CSSProperties>(
    () => ({
      background: '#111827',
      color: '#fff',
      border: '1px solid rgba(17,24,39,0.12)',
    }),
    []
  );

  const BTN_SECONDARY = useMemo<React.CSSProperties>(
    () => ({
      background: '#f3f4f6',
      color: '#111827',
      border: '1px solid #d1d5db',
    }),
    []
  );

  const LABEL_STYLE = useMemo<React.CSSProperties>(
    () => ({
      fontSize: 11,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: '#6b7280',
      fontWeight: 700,
    }),
    []
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('cosmosx_user');
      if (raw) {
        const user = JSON.parse(raw) as AuthUser;
        if (user?.username) setCurrentUser(user);
      }
    } catch {
      // ignore
    } finally {
      setAuthChecked(true);
    }
  }, []);

  const loadFilterOptions = React.useCallback(async () => {
    setFiltersLoading(true);
    setFiltersError(null);
    try {
      const result = await fetchWithBody(DASHBOARD_CATALOGS_ENDPOINT);
      const unauthorized = result.res ? result.res.status === 401 || result.res.status === 403 : false;
      if (unauthorized) {
        setFiltersError('Sesión expirada, vuelve a login');
        return;
      }
      if (result.res && result.res.ok) {
        setFilterOptions(normalizeFilterOptions(result.body));
      } else {
        setFilterOptions(EMPTY_FILTER_OPTIONS);
        if (result.res) setFiltersError(`Filtros: ${messageFrom(result.body, result.res)}`);
      }
    } catch (e: any) {
      setFilterOptions(EMPTY_FILTER_OPTIONS);
      setFiltersError(e?.message || 'Error cargando filtros');
    } finally {
      setFiltersLoading(false);
    }
  }, []);

  const loadDashboardData = React.useCallback(
    async (activeFilters: DashboardFilters, options?: { resetError?: boolean }) => {
      if (options?.resetError) setError(null);
      setLoading(true);
      setRows([]);
      setTotalRows(0);

      try {
        const queryUrl = `${DASHBOARD_RESULTS_ENDPOINT}${buildQueryString(activeFilters)}`;
        const query = await fetchWithBody(queryUrl);
        const unauthorized = query.res ? query.res.status === 401 || query.res.status === 403 : false;

        if (unauthorized) {
          setMetrics(null);
          setRows([]);
          setTotalRows(0);
          setError('Sesión expirada, vuelve a login');
          return;
        }

        if (query.res && query.res.ok) {
          const normalized = normalizeDashboardResults(query.body);
          setMetrics(normalized.metrics || EMPTY_METRICS);
          setRows(Array.isArray(normalized.items) ? normalized.items : []);
          setTotalRows(Number.isFinite(normalized.totalRows) ? normalized.totalRows : normalized.items?.length ?? 0);
          setError(null);
        } else if (query.res) {
          setMetrics(EMPTY_METRICS);
          setRows([]);
          setTotalRows(0);
          setError(`Dashboard: ${messageFrom(query.body, query.res)}`);
        } else {
          setMetrics(EMPTY_METRICS);
          setRows([]);
          setTotalRows(0);
          setError('Dashboard: sin respuesta del servidor');
        }
      } catch (e: any) {
        setMetrics(EMPTY_METRICS);
        setRows([]);
        setTotalRows(0);
        setError(e?.message || 'Error cargando métricas.');
      } finally {
        setFiltersApplied(hasFilters(activeFilters));
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'editor')) return;
    loadFilterOptions();
    loadDashboardData(INITIAL_FILTERS, { resetError: true });
  }, [currentUser, loadDashboardData, loadFilterOptions]);

  const handleFilterChange = (key: keyof DashboardFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleApplyFilters = () => {
    loadDashboardData(filters, { resetError: true });
  };

  const handleResetFilters = () => {
    setFilters(INITIAL_FILTERS);
    setFiltersApplied(false);
    loadDashboardData(INITIAL_FILTERS, { resetError: true });
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const url = `${DASHBOARD_EXPORT_ENDPOINT}${buildQueryString(filters)}`;
      const res = await fetch(url, { credentials: 'include', cache: 'no-store' }).catch(() => null);
      if (!res || !res.ok) {
        const body = res ? await readBody(res) : null;
        if (res && (res.status === 401 || res.status === 403)) throw new Error('Sesión expirada, vuelve a login');
        throw new Error(messageFrom(body, res));
      }

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      const ts = new Date().toISOString().split('T')[0];
      link.download = hasFilters(filters) ? `dashboard-${ts}-filtrado.csv` : `dashboard-${ts}.csv`;
      link.rel = 'noopener noreferrer';
      link.click();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (e: any) {
      setError((prev) => {
        const msg = e?.message || 'No se pudo descargar CSV';
        return prev ? `${prev} | ${msg}` : msg;
      });
    } finally {
      setExporting(false);
    }
  };

  const safeCodes = metrics?.codes ?? (EMPTY_METRICS.codes as NonNullable<MetricsData['codes']>);
  const safeVisits = metrics?.visits ?? (EMPTY_METRICS.visits as NonNullable<MetricsData['visits']>);
  const safeComments = metrics?.comments ?? (EMPTY_METRICS.comments as NonNullable<MetricsData['comments']>);
  const safeRows = Array.isArray(rows) ? rows : [];

  if (!authChecked) return null;

  if (!currentUser) {
    return (
      <main className="layout-main">
        <div className="layout-stack">
          <section className="home-card">
            <div className="home-tag">COSMOSX</div>
            <h1 className="home-title">Acceso restringido</h1>
            <p className="home-sub">Esta sección requiere iniciar sesión.</p>
            <a
              href="/login"
              className="home-config-btn"
              style={{ background: '#111827', color: '#fff', border: '1px solid rgba(0,0,0,0.15)' }}
            >
              Ir a login
            </a>
          </section>
        </div>
      </main>
    );
  }

  if (currentUser.role !== 'admin' && currentUser.role !== 'editor') {
    return (
      <main className="layout-main">
        <div className="layout-stack">
          <section className="home-card">
            <div className="home-tag">COSMOSX</div>
            <h1 className="home-title">No autorizado</h1>
            <p className="home-sub">Solo colaboradores administradores pueden ver el dashboard.</p>
            <a href="/admin" className="home-config-btn" style={BTN_PRIMARY}>
              ← Volver
            </a>
          </section>
        </div>
      </main>
    );
  }

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return Number.isNaN(d.getTime()) ? dateStr : d.toLocaleDateString();
    } catch {
      return dateStr;
    }
  };

  const buildRowSubtitle = (row: Record<string, unknown>) => {
    const parts: string[] = [];
    const maybeAdd = (value?: unknown, formatter?: (v: unknown) => string) => {
      if (value === undefined || value === null || value === '') return;
      parts.push(formatter ? formatter(value) : String(value));
    };

    maybeAdd(row?.estado ?? row?.state);
    maybeAdd(row?.municipio ?? row?.city);
    maybeAdd(row?.grupo ?? row?.group);
    maybeAdd(row?.visitType ?? row?.visit_type);
    maybeAdd(row?.calibracion);

    const dateValue = row?.visit_date ?? row?.fecha ?? row?.date;
    if (dateValue) maybeAdd(dateValue, (v) => formatDate(String(v)));

    return parts.length ? parts.join(' · ') : '—';
  };

  const createPieChart = (data: Record<string, number>) => {
    const total = Object.values(data).reduce((sum, val) => sum + val, 0);
    if (total === 0) return null;

    const colors = ['#60a5fa', '#c084fc', '#34d399', '#fbbf24'];
    let accumulated = 0;
    const stops: string[] = [];

    Object.entries(data).forEach(([_, count], idx) => {
      const pct = (count / total) * 100;
      const color = colors[idx % colors.length];
      stops.push(`${color} ${accumulated}% ${accumulated + pct}%`);
      accumulated += pct;
    });

    return (
      <div
        style={{
          width: 200,
          height: 200,
          borderRadius: '50%',
          background: `conic-gradient(${stops.join(', ')})`,
          margin: '0 auto',
        }}
      />
    );
  };

  const groupLabelMap: Record<string, string> = {
    '1': 'Gr-2000',
    '2': 'Gr-500',
    '3': 'Gr-Int',
    '4': 'Gr-Ext',
  };

  const formatGroupLabel = (key: string, labels?: Record<string, string>) => {
    const trimmed = key?.toString().trim();
    if (!trimmed) return key;
    if (labels && labels[trimmed]) return labels[trimmed];
    if (groupLabelMap[trimmed]) return groupLabelMap[trimmed];
    return trimmed.startsWith('Gr-') ? trimmed : `Gr-${trimmed}`;
  };

  return (
    <main className="admin-layout">
      <div className="admin-inner">
        <AppHeader
          title="COSMOSX"
          subtitle="Dashboard Operacional"
          user={{ username: currentUser.username, role: currentUser.role }}
          showAsignaciones={true}
          showAdmin={true}
          showVisitas={true}
          showDashboard={true}
        />

        <section className="admin-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h2 className="admin-list-title" style={{ margin: 0 }}>
                Filtros
              </h2>
              <p className="admin-status admin-status-muted" style={{ margin: '4px 0 0' }}>
                Refina los resultados del dashboard
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {filtersApplied && (
                <span
                  style={{
                    background: '#111827',
                    color: '#fff',
                    borderRadius: 999,
                    padding: '6px 12px',
                    fontSize: 12,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  Filtros aplicados
                </span>
              )}
              {filtersLoading && <span className="admin-status admin-status-muted">Cargando filtros…</span>}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              marginTop: 14,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={LABEL_STYLE}>Usuario</label>
              <select className="admin-select" value={filters.user} onChange={(e) => handleFilterChange('user', e.target.value)} disabled={loading}>
                <option value="">Todos</option>
                {filterOptions.user.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={LABEL_STYLE}>Subusuario</label>
              <select className="admin-select" value={filters.sub} onChange={(e) => handleFilterChange('sub', e.target.value)} disabled={loading}>
                <option value="">Todos</option>
                {filterOptions.sub.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={LABEL_STYLE}>Estado</label>
              <select className="admin-select" value={filters.estado} onChange={(e) => handleFilterChange('estado', e.target.value)} disabled={loading}>
                <option value="">Todos</option>
                {filterOptions.estado.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={LABEL_STYLE}>Municipio</label>
              <select className="admin-select" value={filters.municipio} onChange={(e) => handleFilterChange('municipio', e.target.value)} disabled={loading}>
                <option value="">Todos</option>
                {filterOptions.municipio.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={LABEL_STYLE}>Grupo</label>
              <select className="admin-select" value={filters.grupo} onChange={(e) => handleFilterChange('grupo', e.target.value)} disabled={loading}>
                <option value="">Todos</option>
                {filterOptions.grupo.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={LABEL_STYLE}>Calibración</label>
              <select className="admin-select" value={filters.calibracion} onChange={(e) => handleFilterChange('calibracion', e.target.value)} disabled={loading}>
                <option value="">Todas</option>
                {filterOptions.calibracion.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={LABEL_STYLE}>M13</label>
              <select className="admin-select" value={filters.m13} onChange={(e) => handleFilterChange('m13', e.target.value)} disabled={loading}>
                <option value="">Todos</option>
                {filterOptions.m13.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={LABEL_STYLE}>Baja</label>
              <select className="admin-select" value={filters.baja} onChange={(e) => handleFilterChange('baja', e.target.value)} disabled={loading}>
                <option value="">Todas</option>
                {filterOptions.baja.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={LABEL_STYLE}>Tipo visita</label>
              <select className="admin-select" value={filters.visitType} onChange={(e) => handleFilterChange('visitType', e.target.value)} disabled={loading}>
                <option value="">Todas</option>
                {filterOptions.visitType.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={LABEL_STYLE}>Desde</label>
              <input type="date" className="admin-input" value={filters.from} onChange={(e) => handleFilterChange('from', e.target.value)} disabled={loading} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={LABEL_STYLE}>Hasta</label>
              <input type="date" className="admin-input" value={filters.to} onChange={(e) => handleFilterChange('to', e.target.value)} disabled={loading} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={LABEL_STYLE}>Búsqueda libre</label>
              <input
                type="text"
                className="admin-input"
                placeholder="Código, referencia…"
                value={filters.q}
                onChange={(e) => handleFilterChange('q', e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              justifyContent: 'flex-end',
              alignItems: 'center',
              marginTop: 14,
            }}
          >
            <button className="home-config-btn" style={BTN_SECONDARY} onClick={handleResetFilters} disabled={loading}>
              Limpiar
            </button>
            <button className="home-config-btn" style={BTN_PRIMARY} onClick={handleApplyFilters} disabled={loading}>
              Aplicar filtros
            </button>
            <button
              className="home-config-btn"
              style={{ ...BTN_SECONDARY, borderStyle: 'dashed' }}
              onClick={handleExportCsv}
              disabled={exporting || loading}
            >
              {exporting ? 'Descargando…' : 'Descargar CSV'}
            </button>
          </div>

          {filtersError && (
            <p className="admin-status admin-status-error" style={{ marginTop: 10 }}>
              {filtersError}
            </p>
          )}
        </section>

        {loading && (
          <section className="admin-card">
            <p className="admin-status admin-status-muted">Cargando métricas…</p>
          </section>
        )}

        {error && (
          <section className="admin-card">
            <p className="admin-status admin-status-error">{error}</p>
          </section>
        )}

        {metrics && (
          <>
            <section className="admin-card">
              <h2 className="admin-list-title">Códigos</h2>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
                <div
                  style={{
                    flex: '1 1 160px',
                    padding: 12,
                    borderRadius: 14,
                    background: '#f9fafb',
                    border: '1px solid #e5e7eb',
                  }}
                >
                  <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#6b7280' }}>Total</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{safeCodes.total}</div>
                </div>

                <div
                  style={{
                    flex: '1 1 160px',
                    padding: 12,
                    borderRadius: 14,
                    background: '#f9fafb',
                    border: '1px solid #e5e7eb',
                  }}
                >
                  <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#6b7280' }}>M13</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{safeCodes.m13Count}</div>
                </div>

                {currentUser.role === 'admin' && (
                  <div
                    style={{
                      flex: '1 1 160px',
                      padding: 12,
                      borderRadius: 14,
                      background: '#f9fafb',
                      border: '1px solid #e5e7eb',
                    }}
                  >
                    <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#6b7280' }}>Asignados</div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{safeCodes.assignedCount}</div>
                  </div>
                )}

                <div
                  style={{
                    flex: '1 1 160px',
                    padding: 12,
                    borderRadius: 14,
                    background: '#f9fafb',
                    border: '1px solid #e5e7eb',
                  }}
                >
                  <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#6b7280' }}>Cal-S</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{safeCodes.calSolicitadas}</div>
                </div>

                <div
                  style={{
                    flex: '1 1 160px',
                    padding: 12,
                    borderRadius: 14,
                    background: '#f9fafb',
                    border: '1px solid #e5e7eb',
                  }}
                >
                  <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#6b7280' }}>Cal-R</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{safeCodes.calRealizadas}</div>
                </div>
              </div>

              {Object.keys(safeCodes.byGroup).length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 10 }}>Por Grupo</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {Object.entries(safeCodes.byGroup).map(([group, count]) => (
                      <div
                        key={group}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #e5e7eb',
                          borderRadius: 14,
                          padding: '10px 14px',
                          minWidth: 120,
                          boxShadow: '0 10px 20px rgba(15, 23, 42, 0.06)',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: '#6b7280',
                          }}
                        >
                          {formatGroupLabel(group, safeCodes.byGroupLabel)}
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', marginTop: 2 }}>{count}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="admin-card">
              <h2 className="admin-list-title">Visitas</h2>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
                <div
                  style={{
                    flex: '1 1 160px',
                    padding: 12,
                    borderRadius: 14,
                    background: '#f9fafb',
                    border: '1px solid #e5e7eb',
                  }}
                >
                  <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#6b7280' }}>Últimos 30 días</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{safeVisits.monthCount}</div>
                </div>
              </div>

              {Object.keys(safeVisits.byType).length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 10 }}>Por Tipo</div>

                  {createPieChart(safeVisits.byType)}

                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 10,
                      marginTop: 12,
                      justifyContent: 'center',
                    }}
                  >
                    {Object.entries(safeVisits.byType).map(([type, count], idx) => (
                      <div key={`${String(type)}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: 3,
                            background: ['#60a5fa', '#c084fc', '#34d399', '#fbbf24'][idx % 4],
                          }}
                        />
                        <span style={{ fontSize: 12, color: '#374151' }}>
                          {String(type)}: <strong>{count}</strong>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {safeVisits.last10.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 10 }}>Últimas 10 Visitas</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {safeVisits.last10.map((visit) => (
                      <div
                        key={visit.id}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 10,
                          background: '#f9fafb',
                          border: '1px solid #e5e7eb',
                          fontSize: 12,
                        }}
                      >
                        <strong>{visit.code}</strong> · {formatDate(visit.visit_date)} · {visit.visit_type}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="admin-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 className="admin-list-title" style={{ margin: 0 }}>
                  Resultados
                </h2>
                <span className="admin-status admin-status-muted">Total rows: {totalRows}</span>
              </div>

              {safeRows.length === 0 ? (
                <p className="admin-status admin-status-muted" style={{ marginTop: 10 }}>
                  Sin resultados
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  {safeRows.map((row, idx) => {
                    const title = String(row?.code ?? row?.codigo ?? row?.id ?? row?.folio ?? row?.referencia ?? row?.reference ?? '—');
                    const subtitle = buildRowSubtitle(row);
                    const actor = row?.user ?? row?.usuario ?? row?.encargado ?? row?.sub ?? '';
                    const keyRaw = row?.id ?? row?.code ?? row?.codigo ?? row?.folio ?? row?.referencia ?? row?.reference ?? `row-${idx}`;
const key = typeof keyRaw === 'string' || typeof keyRaw === 'number' ? String(keyRaw) : `row-${idx}`;

return (
  <div
    key={key}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 12,
                          background: '#f9fafb',
                          border: '1px solid #e5e7eb',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 13, color: '#111827' }}>{title}</strong>
                          {actor && <span style={{ fontSize: 11, color: '#6b7280' }}>{String(actor)}</span>}
                        </div>
                        <div style={{ fontSize: 12, color: '#374151' }}>{subtitle}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {safeComments.length > 0 && (
              <section className="admin-card">
                <h2 className="admin-list-title">Últimos Comentarios</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                  {safeComments.map((comment) => (
                    <div
                      key={comment.id}
                      style={{
                        padding: 12,
                        borderRadius: 14,
                        background: '#f9fafb',
                        border: '1px solid #e5e7eb',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                        <strong style={{ fontSize: 12, color: '#111827' }}>{comment.code}</strong>
                        <span style={{ fontSize: 11, color: '#6b7280' }}>
                          {comment.actor_username} · {formatDate(comment.created_at)}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: '#374151' }}>{comment.comentario}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
