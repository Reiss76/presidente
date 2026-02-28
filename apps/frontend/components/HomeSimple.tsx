'use client';

import React, { useEffect, useMemo, useState } from 'react';
import AppHeader from './AppHeader';
import { getApiBase, fetchJson } from '../lib/api';

type AuthUser = {
  id: number;
  username: string;
  role: string;
};

type CodeItem = {
  id: number;
  code: string;
  razon_social?: string | null;
  direccion?: string | null;
  municipio?: string | null;
  estado?: string | null;
  grupo_id?: number | null;
  encargado_actual?: string | null;
  encargado_anterior?: string | null;
  comentario?: string | null;
  baja?: boolean | null;
  calibracion?: string | null; // "S" | "R"
  m13?: boolean | null;
};

type CommentItem = {
  id: number;
  code_id: number;
  comentario: string;
  created_at: string;
  actor_username?: string | null;
  actor_role?: string | null;
};

type FileKind = 'general' | 'cal';

type FileItem = {
  id: number;
  code_id: number;
  kind: string;
  fileName: string;
  contentType: string | null;
  size: number | null;
  storageKey: string;
  createdAt: string | Date;
  downloadUrl: string | null;
};

// =========
// VISITAS (HOME)
// =========
type VisitType = 'verificacion' | 'calibracion' | 'supervision' | 'cateo';

type VisitItem = {
  id: number;
  code_id: number;
  visit_date: string; // YYYY-MM-DD
  visit_type: VisitType;
  notes?: string | null;
  created_at?: string | null;
};

type VisitFileItem = {
  id: number;
  visit_id: number;
  code_id: number;
  fileName: string;
  contentType: string | null;
  size: number | null;
  storageKey: string;
  createdAt: string | Date;
};

const API = getApiBase();

/**
 * MAPA DE GRUPOS (frontend)
 */
const GROUP_LABELS: Record<number, string> = {
  1: 'Gr-2000',
  2: 'Gr-500',
  3: 'Gr-Int',
  4: 'Gr-Ext',
};

function calLabel(v?: string | null) {
  if (v === 'S') return 'Cal-S';
  if (v === 'R') return 'Cal-R';
  return '';
}

function visitLabel(t: VisitType) {
  if (t === 'verificacion') return 'Verificación';
  if (t === 'calibracion') return 'Calibración';
  if (t === 'cateo') return 'Cateo';
  return 'Supervisión';
}

function extractPureCode(input: string): string {
  if (!input) return '';
  const clean = String(input).toUpperCase().replace(/\s+/g, '');
  const m = clean.match(/PL\/(\d+)\//);
  if (m?.[1]) return m[1];
  if (/^\d+$/.test(clean)) return clean;
  const digits = clean.match(/\d+/);
  return digits ? digits[0] : '';
}

function normalizeCodes(list: string[]): string[] {
  return list
    .map((v) => v.trim())
    .filter(Boolean)
    .map(extractPureCode)
    .filter(Boolean);
}

function groupLabelFromId(grupo_id?: number | null): string {
  if (grupo_id == null) return '';
  const gid = Number(grupo_id);
  return GROUP_LABELS[gid] ?? `Gr-${gid}`;
}

function groupKind(grupo_id?: number | null): 'g2000' | 'g500' | 'gint' | 'gext' | 'other' {
  if (grupo_id == null) return 'other';
  const gid = Number(grupo_id);

  if (gid === 2000 || gid === 1) return 'g2000';
  if (gid === 500 || gid === 2) return 'g500';
  if (gid === 3) return 'gint';
  if (gid === 4) return 'gext';

  return 'other';
}

function formatBytes(n?: number | null) {
  if (!n || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDateTime(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatVisitDate(d: string) {
  try {
    const dt = new Date(d);
    if (!Number.isNaN(dt.getTime())) return dt.toLocaleDateString();
    return d;
  } catch {
    return d;
  }
}

/** ✅ Botones monocromáticos (sin verde) */
const BTN_PRIMARY: React.CSSProperties = {
  background: '#111827',
  color: '#fff',
  border: '1px solid rgba(17,24,39,0.12)',
};
const BTN_SECONDARY: React.CSSProperties = {
  background: '#f3f4f6',
  color: '#111827',
  border: '1px solid rgba(17,24,39,0.10)',
};
const BTN_DANGER: React.CSSProperties = {
  background: '#fff',
  color: '#991b1b',
  border: '1px solid rgba(220,38,38,0.25)',
};

export default function HomeSimple() {
  // =========
  // MOUNT + AUTH
  // =========
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  // =========
  // BUSCAR POR CÓDIGO
  // =========
  const [codeQuery, setCodeQuery] = useState('');
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeResult, setCodeResult] = useState<CodeItem | null>(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchText, setResearchText] = useState<string>('');
  const [researchSources, setResearchSources] = useState<Array<{ title: string; url: string }>>([]);

  // =========
  // BUSCAR POR TEXTO
  // =========
  const [textQuery, setTextQuery] = useState('');
  const [textLoading, setTextLoading] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [textResults, setTextResults] = useState<CodeItem[]>([]);

  // =========
  // LOTE
  // =========
  const [bulkInput, setBulkInput] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResults, setBulkResults] = useState<CodeItem[]>([]);
  const [bulkNormCores, setBulkNormCores] = useState<string[]>([]);
  const [bulkDots, setBulkDots] = useState('');

  // =========
  // FOTO (OCR)
  // =========
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoResults, setPhotoResults] = useState<CodeItem[]>([]);
  const [photoCodesRaw, setPhotoCodesRaw] = useState<string[]>([]);

  // =========
  // MODAL COMENTARIOS
  // =========
  const [commentsOpenFor, setCommentsOpenFor] = useState<CodeItem | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentsList, setCommentsList] = useState<CommentItem[]>([]);

  // =========
  // MODAL DOCUMENTOS (Home: solo ver/descargar)
  // =========
  const [docsOpenFor, setDocsOpenFor] = useState<CodeItem | null>(null);
  const [docsKind, setDocsKind] = useState<FileKind>('general');
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [docsItems, setDocsItems] = useState<FileItem[]>([]);

  // =========
  // MODAL VISITAS (HOME)
  // =========
  const [visitsOpenFor, setVisitsOpenFor] = useState<CodeItem | null>(null);
  const [visitsLoading, setVisitsLoading] = useState(false);
  const [visitsError, setVisitsError] = useState<string | null>(null);
  const [visitsItems, setVisitsItems] = useState<VisitItem[]>([]);

  // =========
  // MODAL ARCHIVOS POR VISITA (HOME: ver/descargar)
  // =========
  const [visitFilesOpen, setVisitFilesOpen] = useState<{ code: CodeItem; visit: VisitItem } | null>(null);
  const [visitFilesLoading, setVisitFilesLoading] = useState(false);
  const [visitFilesError, setVisitFilesError] = useState<string | null>(null);
  const [visitFilesItems, setVisitFilesItems] = useState<VisitFileItem[]>([]);
  const SESSION_EXPIRED_MSG = 'Sesión expirada, vuelve a login';

  async function safeJson(res: Response) {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return { message: await res.text() };
  }

  // =========
  // COMMENTS
  // =========
  async function openCommentsModal(item: CodeItem) {
    setCommentsOpenFor(item);
    setCommentsError(null);
    setCommentsList([]);
    setCommentsLoading(true);

    try {
      const res = await fetch(`${API}/codes/${item.id}/comments`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);
      setCommentsList(Array.isArray(data) ? (data as any) : []);
    } catch (e: any) {
      setCommentsError(e?.message || 'No se pudo cargar el historial.');
      setCommentsList([]);
    } finally {
      setCommentsLoading(false);
    }
  }

  function closeCommentsModal() {
    setCommentsOpenFor(null);
    setCommentsError(null);
    setCommentsList([]);
    setCommentsLoading(false);
  }

  // =========
  // DOCS
  // =========
  async function loadDocs(codeId: number, kind: FileKind) {
    setDocsLoading(true);
    setDocsError(null);
    setDocsItems([]);
    try {
      const res = await fetch(`${API}/codes/${codeId}/files?kind=${kind}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);

      const list: any[] = Array.isArray((data as any)?.items)
        ? (data as any).items
        : Array.isArray(data)
          ? (data as any)
          : [];

      setDocsItems(
        list.map((f) => ({
          id: Number(f.id),
          code_id: Number(f.code_id ?? f.codeId ?? codeId),
          kind: String(f.kind ?? kind),
          fileName: String(f.fileName ?? f.file_name ?? 'archivo'),
          contentType: f.contentType ?? f.content_type ?? null,
          size: f.size != null ? Number(f.size) : null,
          storageKey: String(f.storageKey ?? f.storage_key ?? ''),
          createdAt: f.createdAt ?? f.created_at ?? null,
          downloadUrl: f.downloadUrl ?? null,
        })),
      );
    } catch (e: any) {
      setDocsError(e?.message || 'No se pudieron cargar los documentos.');
    } finally {
      setDocsLoading(false);
    }
  }

  async function openDocsModal(item: CodeItem, kind: FileKind) {
    setDocsOpenFor(item);
    setDocsKind(kind);
    await loadDocs(item.id, kind);
  }

  function closeDocsModal() {
    setDocsOpenFor(null);
    setDocsError(null);
    setDocsItems([]);
    setDocsLoading(false);
  }

  // =========
  // VISITS
  // =========
  async function loadVisitsForCode(item: CodeItem) {
    setVisitsOpenFor(item);
    setVisitsLoading(true);
    setVisitsError(null);
    setVisitsItems([]);

    try {
      const res = await fetch(`${API}/codes/${item.id}/visits`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);

      const list: any[] = Array.isArray((data as any)?.items)
        ? (data as any).items
        : Array.isArray(data)
          ? (data as any)
          : [];

      const mapped: VisitItem[] = list.map((v) => ({
        id: Number(v.id),
        code_id: Number(v.code_id),
        visit_date: String(v.visit_date),
        visit_type: String(v.visit_type) as VisitType,
        notes: v.notes ?? null,
        created_at: v.created_at ?? null,
      }));

      mapped.sort((a, b) => String(b.visit_date).localeCompare(String(a.visit_date)));
      setVisitsItems(mapped);
    } catch (e: any) {
      setVisitsError(e?.message || 'No se pudieron cargar las visitas.');
      setVisitsItems([]);
    } finally {
      setVisitsLoading(false);
    }
  }

  function closeVisitsModal() {
    setVisitsOpenFor(null);
    setVisitsError(null);
    setVisitsItems([]);
    setVisitsLoading(false);
  }

  // =========
  // VISIT FILES (home: ver/descargar)
  // =========
  async function openVisitFilesModal(code: CodeItem, visit: VisitItem) {
    setVisitFilesOpen({ code, visit });
    setVisitFilesLoading(true);
    setVisitFilesError(null);
    setVisitFilesItems([]);

    try {
      const res = await fetch(`${API}/codes/${code.id}/visits/${visit.id}/files`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);

      const list: any[] = Array.isArray((data as any)?.items)
        ? (data as any).items
        : Array.isArray(data)
          ? (data as any)
          : [];

      setVisitFilesItems(
        list.map((f) => ({
          id: Number(f.id),
          visit_id: Number(f.visit_id),
          code_id: Number(f.code_id),
          fileName: String(f.fileName ?? f.file_name ?? 'archivo'),
          contentType: f.contentType ?? f.content_type ?? null,
          size: f.size != null ? Number(f.size) : null,
          storageKey: String(f.storageKey ?? f.storage_key ?? ''),
          createdAt: f.createdAt ?? f.created_at ?? null,
        })),
      );
    } catch (e: any) {
      setVisitFilesError(e?.message || 'No se pudieron cargar los archivos de la visita.');
    } finally {
      setVisitFilesLoading(false);
    }
  }

  function closeVisitFilesModal() {
    setVisitFilesOpen(null);
    setVisitFilesError(null);
    setVisitFilesItems([]);
    setVisitFilesLoading(false);
  }

  // =========
  // INIT
  // =========
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    try {
      const raw = window.localStorage.getItem('cosmosx_user');
      const parsed = raw ? (JSON.parse(raw) as AuthUser) : null;
      if (parsed?.username) setUser(parsed);
      else setUser(null);
    } catch {
      setUser(null);
    }
  }, [mounted]);

  function handleLogout() {
    try {
      window.localStorage.removeItem('cosmosx_user');
      document.cookie = 'cosmosx_session=; Max-Age=0; path=/; secure; sameSite=lax;';
    } catch {}
    window.location.href = '/login';
  }

  function clearAllResults() {
    setCodeError(null);
    setCodeResult(null);
    setTextError(null);
    setTextResults([]);
    setBulkError(null);
    setBulkResults([]);
    setBulkNormCores([]);
    setPhotoError(null);
    setPhotoResults([]);
    setPhotoCodesRaw([]);
  }

  function openMaps(item: CodeItem) {
    const parts = [item.direccion, item.municipio, item.estado].filter(Boolean);
    if (!parts.length) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(', '))}`;
    window.open(url, '_blank');
  }

  // =========
  // ✅ COLORES DE TARJETAS: SE CONSERVAN (status colors)
  // =========
  function borderColorForItem(item: CodeItem) {
    if (item.baja === true) return '#374151';

    const hasUser = !!item.encargado_actual && String(item.encargado_actual).trim() !== '';
    if (!hasUser) return '#dc2626';

    const kind = groupKind(item.grupo_id);
    if (kind === 'g2000') return '#60a5fa';
    if (kind === 'g500') return '#c084fc';

    return '#22c55e';
  }

  function backgroundForItem(item: CodeItem) {
    if (item.baja === true) return 'rgba(17, 24, 39, 0.85)';

    const hasUser = !!item.encargado_actual && String(item.encargado_actual).trim() !== '';
    if (!hasUser) return '#fee2e2';

    const kind = groupKind(item.grupo_id);
    if (kind === 'g2000') return '#eff6ff';
    if (kind === 'g500') return '#faf5ff';

    return '#ecfdf5';
  }

  function renderResultCard(item: CodeItem) {
    const borderColor = borderColorForItem(item);
    const groupLabel = groupLabelFromId(item.grupo_id);
    const cal = calLabel(item.calibracion);

    return (
      <article
        key={item.id}
        className="home-result-card"
        style={{
          padding: '18px 20px',
          borderRadius: 18,
          border: `3px solid ${borderColor}`,
          background: backgroundForItem(item),
          color: item.baja === true ? '#f9fafb' : '#111827',
          position: 'relative',
        }}
      >
        {/* BAJA arriba derecha */}
        {item.baja === true && (
          <div
            style={{
              position: 'absolute',
              right: 12,
              top: 10,
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 9999,
              background: '#dc2626',
              color: '#fff',
              fontWeight: 800,
              letterSpacing: '.04em',
            }}
          >
            BAJA
          </div>
        )}

        {item.m13 === true && (
          <div
            style={{
              position: 'absolute',
              left: 12,
              top: 10,
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 9999,
              background: '#111827',
              color: '#fff',
              fontWeight: 800,
              letterSpacing: '.04em',
              border: '1px solid rgba(17,24,39,0.12)',
            }}
          >
            M13
          </div>
        )}

        {/* Cal arriba derecha (clic -> docs calibración) */}
        {cal && (
          <div
            onClick={() => openDocsModal(item, 'cal')}
            title="Ver documentos de calibración"
            style={{
              position: 'absolute',
              right: 12,
              top: item.baja === true ? 40 : 10,
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 9999,
              background: item.calibracion === 'S' ? '#0ea5e9' : '#111827',
              color: '#fff',
              fontWeight: 800,
              letterSpacing: '.04em',
              border:
                item.baja === true
                  ? '1px solid rgba(255,255,255,0.18)'
                  : '1px solid rgba(17,24,39,0.12)',
              opacity: item.baja === true ? 0.95 : 1,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            {cal}
          </div>
        )}

        {/* Grupo abajo derecha */}
        {groupLabel && (
          <div
            style={{
              position: 'absolute',
              right: 12,
              bottom: 10,
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 9999,
              border:
                item.baja === true
                  ? '1px solid rgba(255,255,255,0.18)'
                  : '1px solid rgba(17,24,39,0.12)',
              background: item.baja === true ? 'rgba(0,0,0,0.25)' : '#ffffff',
              color: item.baja === true ? '#f9fafb' : '#111827',
              fontWeight: 800,
              letterSpacing: '.04em',
            }}
          >
            {groupLabel}
          </div>
        )}

        <div onClick={() => openMaps(item)} style={{ cursor: 'pointer' }}>
          <div style={{ fontWeight: 700 }}>{item.code}</div>

          <div style={{ fontWeight: 600, marginTop: 4 }}>
            {item.razon_social ?? '—'}
          </div>

          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
            {item.direccion ?? ''}
            {(item.municipio || item.estado) && (
              <>
                {item.direccion ? ' · ' : ''}
                {item.municipio ?? ''}
                {item.estado ? `, ${item.estado}` : ''}
              </>
            )}
          </div>
        </div>

        <div style={{ fontSize: 12, marginTop: 10 }}>
          Usuario:{' '}
          <strong>
            {item.encargado_actual?.trim()
              ? item.encargado_actual
              : 'Sin asignar'}
          </strong>
        </div>

        <div style={{ fontSize: 12 }}>
          Sub:{' '}
          <strong>
            {item.encargado_anterior?.trim() ? item.encargado_anterior : '—'}
          </strong>
        </div>

        {/* ✅ botones monocromáticos */}
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="home-config-btn" style={BTN_SECONDARY} onClick={() => openCommentsModal(item)}>
            Ver comentarios
          </button>

          <button type="button" className="home-config-btn" style={BTN_SECONDARY} onClick={() => loadVisitsForCode(item)}>
            Ver visitas
          </button>

          <button type="button" className="home-config-btn" style={BTN_SECONDARY} onClick={() => openDocsModal(item, 'general')}>
            Ver documentos
          </button>
        </div>
      </article>
    );
  }

  // =========
  // CSV (lote)
  // =========
  function downloadBulkCSV() {
    if (!bulkResults.length) return;

    const headers = [
      'code',
      'razon_social',
      'direccion',
      'municipio',
      'estado',
      'grupo',
      'usuario',
      'sub',
      'calibracion',
      'baja',
    ];

    const rows = bulkResults.map((r) => [
      r.code ?? '',
      r.razon_social ?? '',
      r.direccion ?? '',
      r.municipio ?? '',
      r.estado ?? '',
      groupLabelFromId(r.grupo_id),
      r.encargado_actual ?? '',
      r.encargado_anterior ?? '',
      r.calibracion ?? '',
      r.baja === true ? 'BAJA' : '',
    ]);

    const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const csv =
      headers.map(escape).join(',') +
      '\n' +
      rows.map((row) => row.map((v) => escape(String(v))).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `cosmosx_lote_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // =========
  // CSV para resultados de foto (OCR)
  // =========
  function downloadPhotoCsv() {
    if (!photoResults.length) return;

    const headers = [
      'code',
      'razon_social',
      'estado',
      'municipio',
      'direccion',
      'grupo_id',
      'encargado_actual',
      'baja',
      'calibracion',
      'm13',
    ];

    const escapeField = (val: unknown): string => {
      if (val === null || val === undefined) return '""';
      if (typeof val === 'boolean') return `"${val ? 'true' : 'false'}"`;
      return `"${String(val).replace(/"/g, '""')}"`;
    };

    const rows = photoResults.map((r) => [
      r.code,
      r.razon_social,
      r.estado,
      r.municipio,
      r.direccion,
      r.grupo_id,
      r.encargado_actual,
      r.baja,
      r.calibracion,
      r.m13,
    ]);

    const csv =
      headers.join(',') +
      '\n' +
      rows.map((row) => row.map(escapeField).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const filename = `busqueda_foto_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.csv`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // =========
  // “Buscando…” con puntos
  // =========
  useEffect(() => {
    if (!bulkLoading) {
      setBulkDots('');
      return;
    }
    let i = 0;
    const t = window.setInterval(() => {
      i = (i + 1) % 4;
      setBulkDots('.'.repeat(i));
    }, 350);
    return () => window.clearInterval(t);
  }, [bulkLoading]);

  // =========
  // BUSCAR CÓDIGO
  // =========
  async function handleCodeSearch(e: React.FormEvent) {
  e.preventDefault();

  if (!API) {
    setCodeError('API_BASE no está configurado. Define NEXT_PUBLIC_API_URL o NEXT_PUBLIC_API_BASE_URL.');
    return;
  }

  const raw = String(codeQuery || '').trim();
  if (!raw) return;

  // Si el usuario pega un PL completo, lo mandamos tal cual.
  // Si no, mandamos el núcleo numérico (extractPureCode).
  const upper = raw.toUpperCase();
  const codeParam = upper.startsWith('PL/') ? upper : extractPureCode(raw);
  if (!codeParam) return;

  try {
    setCodeLoading(true);
    setCodeError(null);
    setCodeResult(null);
    setResearchError(null);
    setResearchText('');
    setResearchSources([]);

    setTextResults([]);
    setBulkResults([]);
    setPhotoResults([]);

    const res = await fetch(
      `${API}/codes/by-code?code=${encodeURIComponent(codeParam)}`,
      {
        credentials: 'include',
        cache: 'no-store',
      },
    );

    const data = await safeJson(res);

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        setCodeError(SESSION_EXPIRED_MSG);
      } else {
        setCodeError((data as any)?.message || `Error ${res.status}`);
      }
      setCodeResult(null);
      return;
    }

    // Soporta backend que regrese el item directo o dentro de { item: ... }
    const item = (data as any)?.item ?? data;

    if (!item || !(item as any)?.id) {
      setCodeError('No encontrado');
      setCodeResult(null);
      return;
    }

    setCodeResult(item as CodeItem);
  } catch (e: any) {
    setCodeError(`${e?.message || 'Error al buscar.'} (${API}/codes/by-code)`);
    setCodeResult(null);
  } finally {
    setCodeLoading(false);
  }
}

  async function handleResearchCode() {
    if (!codeResult) return;

    try {
      setResearchLoading(true);
      setResearchError(null);
      setResearchText('');
      setResearchSources([]);

      const data = await fetchJson<any>(`/codes/tools/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeResult.code }),
      });

      setResearchText(String(data?.summary || 'Sin resumen.'));
      setResearchSources(Array.isArray(data?.sources) ? data.sources : []);
      if (data?.note) {
        setResearchError(String(data.note));
      }
    } catch (e: any) {
      setResearchError(e?.message || 'No se pudo investigar el PL.');
    } finally {
      setResearchLoading(false);
    }
  }

  // =========
  // BUSCAR TEXTO
  // =========
  async function handleTextSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!API) {
      setTextError('API_BASE no está configurado. Define NEXT_PUBLIC_API_URL o NEXT_PUBLIC_API_BASE_URL.');
      return;
    }
    const q = textQuery.trim();
    if (!q) return;

    try {
      setTextLoading(true);
      setTextError(null);
      setTextResults([]);

      setCodeResult(null);
      setBulkResults([]);
      setPhotoResults([]);

      const res = await fetch(`${API}/codes?query=${encodeURIComponent(q)}`, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
      });
      const data = await safeJson(res);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setTextError(SESSION_EXPIRED_MSG);
        } else {
          setTextError((data as any)?.message || `Error ${res.status}`);
        }
        setTextResults([]);
        return;
      }
      const items: CodeItem[] = Array.isArray(data) ? data : data.items || [];
      setTextResults(items);
      if (!items.length) setTextError('No hay resultados.');
    } catch (e: any) {
      setTextError(`${e?.message || 'Error buscando.'} (${API}/codes)`);
    } finally {
      setTextLoading(false);
    }
  }

  // =========
  // LOTE
  // =========
  async function handleBulkSearch(e: React.FormEvent) {
    e.preventDefault();

    if (!API) {
      setBulkError('API_BASE no está configurado. Define NEXT_PUBLIC_API_URL o NEXT_PUBLIC_API_BASE_URL.');
      return;
    }

    const raw = bulkInput
      .split('\n')
      .map((l) => String(l ?? '').trim())
      .filter(Boolean);

    const normalizedCores = normalizeCodes(raw);
    setBulkNormCores(normalizedCores);

    if (!normalizedCores.length) {
      setBulkError('Pega al menos un código.');
      setBulkResults([]);
      return;
    }

    try {
      setBulkLoading(true);
      setBulkError(null);
      setBulkResults([]);

      setCodeResult(null);
      setTextResults([]);
      setPhotoResults([]);

      const res = await fetch(`${API}/codes/bulk-lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: normalizedCores }),
        credentials: 'include',
        cache: 'no-store',
      });

      const data = (await safeJson(res)) as any;
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setBulkError(SESSION_EXPIRED_MSG);
        } else {
          setBulkError((data as any)?.message || `Error ${res.status}`);
        }
        setBulkResults([]);
        return;
      }
      let items: CodeItem[] = [];
      if (Array.isArray(data)) items = data as CodeItem[];
      else if (Array.isArray((data as any)?.items)) items = (data as any).items as CodeItem[];
      setBulkResults(items);
      if (!items.length) setBulkError('No se encontró ningún código.');
    } catch (e: any) {
      setBulkError(`${e?.message || 'Error procesando la lista.'} (${API}/codes/bulk-lookup)`);
    } finally {
      setBulkLoading(false);
    }
  }

  const bulkNotFound = useMemo(() => {
    if (bulkLoading) return [];
    if (!bulkNormCores.length) return [];
    const foundCores = new Set(bulkResults.map((r) => extractPureCode(r.code)));
    return bulkNormCores.filter((core) => !foundCores.has(core));
  }, [bulkNormCores, bulkResults, bulkLoading]);

  const bulkByUserSummary = useMemo(() => {
    if (!bulkResults.length) return '';
    const counts: Record<string, number> = {};
    for (const r of bulkResults) {
      const u = r.encargado_actual && r.encargado_actual.trim() !== '' ? r.encargado_actual.trim() : 'SIN ASIGNAR';
      counts[u] = (counts[u] || 0) + 1;
    }
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return entries.map(([u, n]) => `${n}: ${u}`).join(' · ');
  }, [bulkResults]);

  // =========
  // FOTO
  // =========
  async function handlePhotoSearch() {
    if (!imageFile) return;

    if (!API) {
      setPhotoError('API_BASE no está configurado. Define NEXT_PUBLIC_API_URL o NEXT_PUBLIC_API_BASE_URL.');
      return;
    }

    try {
      setPhotoLoading(true);
      setPhotoError(null);
      setPhotoResults([]);
      setPhotoCodesRaw([]);

      setCodeResult(null);
      setTextResults([]);
      setBulkResults([]);

      const form = new FormData();
      form.append('file', imageFile);

      const res = await fetch(`${API}/codes/image-search`, {
        method: 'POST',
        body: form,
        credentials: 'include',
        cache: 'no-store',
      });
      const data = await safeJson(res);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setPhotoError(SESSION_EXPIRED_MSG);
        } else {
          setPhotoError((data as any)?.message || `Error ${res.status}`);
        }
        return;
      }
      const codes: string[] = Array.isArray(data?.codes) ? data.codes : [];
      const results: CodeItem[] = Array.isArray(data?.results) ? data.results : [];

      setPhotoCodesRaw(codes);
      setPhotoResults(results);

      if (!results.length) setPhotoError('No se encontraron códigos en la imagen.');
    } catch (e: any) {
      setPhotoError(`${e?.message || 'Error procesando imagen.'} (${API}/codes/image-search)`);
    } finally {
      setPhotoLoading(false);
    }
  }

  const photoNotFound = useMemo(() => {
    const cores = photoCodesRaw.map(extractPureCode).filter(Boolean);
    if (!cores.length) return [];
    const foundCores = new Set(photoResults.map((r) => extractPureCode(r.code)));
    return cores.filter((c) => !foundCores.has(c));
  }, [photoCodesRaw, photoResults]);

  // =========
  // Render early (auth)
  // =========
  if (!mounted) return null;

  if (!user) {
    return (
      <main className="layout-main">
        <div className="layout-stack">
          <section className="home-card" style={{ maxWidth: 420, margin: '0 auto' }}>
            <div className="home-tag">COSMOSX</div>
            <h1 className="home-title">ACCESO REQUERIDO</h1>
            <p className="home-sub">Debes iniciar sesión para usar el buscador.</p>
            <a href="/login" className="home-config-btn" style={{ marginTop: 16, ...BTN_PRIMARY }}>
              Ir a login
            </a>
          </section>
        </div>
      </main>
    );
  }

  // ✅ Parte 2/2 continúa con el return principal y todos los modales + UI
  return (
    <main className="layout-main">
      <div className="layout-stack">
        {/* ===================== */}
        {/* MODAL ARCHIVOS POR VISITA */}
        {/* ===================== */}
        {visitFilesOpen && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
            onClick={closeVisitFilesModal}
          >
            <div
              style={{
                width: '100%',
                maxWidth: 820,
                background: '#fff',
                borderRadius: 18,
                border: '1px solid #e5e7eb',
                boxShadow: '0 18px 60px rgba(0,0,0,0.25)',
                overflow: 'hidden',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid #e5e7eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div>
                  <div className="home-tag">COSMOSX</div>
                  <div style={{ fontSize: 14, fontWeight: 800, marginTop: 2 }}>
                    Archivos de visita
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    {visitFilesOpen.code.code} · {visitFilesOpen.visit.visit_date} ·{' '}
                    {visitLabel(visitFilesOpen.visit.visit_type)}
                  </div>
                </div>

                <button
                  className="home-config-btn"
                  type="button"
                  style={BTN_PRIMARY}
                  onClick={closeVisitFilesModal}
                >
                  Cerrar
                </button>
              </div>

              <div style={{ padding: 16, maxHeight: '70vh', overflow: 'auto' }}>
                {visitFilesLoading && <p className="home-msg">Cargando…</p>}
                {visitFilesError && <p className="home-error">{visitFilesError}</p>}

                {!visitFilesLoading && !visitFilesError && visitFilesItems.length === 0 && (
                  <p className="home-msg">No hay archivos para esta visita.</p>
                )}

                {!visitFilesLoading && visitFilesItems.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {visitFilesItems.map((f) => (
                      <div
                        key={f.id}
                        style={{
                          border: '1px solid #e5e7eb',
                          borderRadius: 14,
                          padding: 12,
                          background: '#f9fafb',
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 12,
                          flexWrap: 'wrap',
                          alignItems: 'center',
                        }}
                      >
                        <div style={{ minWidth: 220 }}>
                          <div style={{ fontSize: 13, fontWeight: 750, color: '#111827' }}>
                            {f.fileName}
                          </div>
                          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                            {formatBytes(f.size)} {f.contentType ? ` · ${f.contentType}` : ''}
                          </div>
                        </div>

                        <a
                          className="home-config-btn"
                          style={BTN_PRIMARY}
                          href={`${API}/codes/${visitFilesOpen.code.id}/visits/${visitFilesOpen.visit.id}/files/${f.id}/download`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Descargar
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ padding: 12, borderTop: '1px solid #e5e7eb' }}>
                <p className="home-sub" style={{ margin: 0 }}>
                  Tip: estos archivos están ligados a una visita específica.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ===================== */}
        {/* MODAL VISITAS */}
        {/* ===================== */}
        {visitsOpenFor && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
            onClick={closeVisitsModal}
          >
            <div
              style={{
                width: '100%',
                maxWidth: 760,
                background: '#fff',
                borderRadius: 18,
                border: '1px solid #e5e7eb',
                boxShadow: '0 18px 60px rgba(0,0,0,0.25)',
                overflow: 'hidden',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid #e5e7eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div>
                  <div className="home-tag">COSMOSX</div>
                  <div style={{ fontSize: 14, fontWeight: 800, marginTop: 2 }}>Visitas</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    {visitsOpenFor.code}
                  </div>
                </div>

                <button
                  className="home-config-btn"
                  type="button"
                  style={BTN_PRIMARY}
                  onClick={closeVisitsModal}
                >
                  Cerrar
                </button>
              </div>

              <div style={{ padding: 16, maxHeight: '70vh', overflow: 'auto' }}>
                {visitsLoading && <p className="home-msg">Cargando…</p>}
                {visitsError && <p className="home-error">{visitsError}</p>}

                {!visitsLoading && !visitsError && visitsItems.length === 0 && (
                  <p className="home-msg">No hay visitas registradas todavía.</p>
                )}

                {!visitsLoading && !visitsError && visitsItems.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {visitsItems.map((v) => (
                      <div
                        key={v.id}
                        style={{
                          border: '1px solid #e5e7eb',
                          borderRadius: 14,
                          padding: 12,
                          background: '#f9fafb',
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 12,
                          flexWrap: 'wrap',
                          alignItems: 'center',
                        }}
                      >
                        <div style={{ minWidth: 260 }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: '#111827' }}>
                            {formatVisitDate(v.visit_date)} · {visitLabel(v.visit_type)}
                          </div>
                          {!!v.notes && (
                            <div style={{ marginTop: 6, fontSize: 12, color: '#111827' }}>
                              {v.notes}
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          className="home-config-btn"
                          style={BTN_SECONDARY}
                          onClick={() => openVisitFilesModal(visitsOpenFor, v)}
                        >
                          Archivos
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ padding: 12, borderTop: '1px solid #e5e7eb' }}>
                <p className="home-sub" style={{ margin: 0 }}>
                  Tip: aquí solo consultas visitas. La captura/edición se hace desde Configuración (Admin).
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ===================== */}
        {/* MODAL DOCUMENTOS */}
        {/* ===================== */}
        {docsOpenFor && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
            onClick={closeDocsModal}
          >
            <div
              style={{
                width: '100%',
                maxWidth: 820,
                background: '#fff',
                borderRadius: 18,
                border: '1px solid #e5e7eb',
                boxShadow: '0 18px 60px rgba(0,0,0,0.25)',
                overflow: 'hidden',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid #e5e7eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div>
                  <div className="home-tag">COSMOSX</div>
                  <div style={{ fontSize: 14, fontWeight: 800, marginTop: 2 }}>
                    Documentos — {docsKind === 'cal' ? 'Calibración' : 'Generales'}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    {docsOpenFor.code}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="home-config-btn"
                    style={docsKind === 'general' ? BTN_PRIMARY : BTN_SECONDARY}
                    onClick={() => {
                      setDocsKind('general');
                      loadDocs(docsOpenFor.id, 'general');
                    }}
                  >
                    General
                  </button>

                  <button
                    type="button"
                    className="home-config-btn"
                    style={docsKind === 'cal' ? BTN_PRIMARY : BTN_SECONDARY}
                    onClick={() => {
                      setDocsKind('cal');
                      loadDocs(docsOpenFor.id, 'cal');
                    }}
                  >
                    Calibración
                  </button>

                  <button
                    className="home-config-btn"
                    type="button"
                    style={BTN_PRIMARY}
                    onClick={closeDocsModal}
                  >
                    Cerrar
                  </button>
                </div>
              </div>

              <div style={{ padding: 16, maxHeight: '70vh', overflow: 'auto' }}>
                {docsLoading && <p className="home-msg">Cargando…</p>}
                {docsError && <p className="home-error">{docsError}</p>}

                {!docsLoading && !docsError && docsItems.length === 0 && (
                  <p className="home-msg">No hay documentos todavía.</p>
                )}

                {!docsLoading && !docsError && docsItems.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {docsItems.map((f) => (
                      <div
                        key={f.id}
                        style={{
                          border: '1px solid #e5e7eb',
                          borderRadius: 14,
                          padding: 12,
                          background: '#f9fafb',
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 12,
                          flexWrap: 'wrap',
                          alignItems: 'center',
                        }}
                      >
                        <div style={{ minWidth: 220 }}>
                          <div style={{ fontSize: 13, fontWeight: 750, color: '#111827' }}>
                            {f.fileName}
                          </div>
                          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                            {formatBytes(f.size)} {f.contentType ? ` · ${f.contentType}` : ''}
                          </div>
                        </div>

                        {/* Descarga via backend (compatible Safari/Chrome) */}
                        <a
                          className="home-config-btn"
                          style={BTN_PRIMARY}
                          href={`${API}/codes/${docsOpenFor.id}/files/${f.id}/download`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Descargar
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ padding: 12, borderTop: '1px solid #e5e7eb' }}>
                <p className="home-sub" style={{ margin: 0 }}>
                  Tip: “General” son documentos normales. “Calibración” son evidencias Cal-S/Cal-R.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ===================== */}
        {/* MODAL COMENTARIOS */}
        {/* ===================== */}
        {commentsOpenFor && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
            onClick={closeCommentsModal}
          >
            <div
              style={{
                width: '100%',
                maxWidth: 720,
                background: '#fff',
                borderRadius: 18,
                border: '1px solid #e5e7eb',
                boxShadow: '0 18px 60px rgba(0,0,0,0.25)',
                overflow: 'hidden',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid #e5e7eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div>
                  <div className="home-tag">COSMOSX</div>
                  <div style={{ fontSize: 14, fontWeight: 800, marginTop: 2 }}>
                    Historial de comentarios
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    {commentsOpenFor.code}
                  </div>
                </div>

                <button
                  className="home-config-btn"
                  type="button"
                  style={BTN_PRIMARY}
                  onClick={closeCommentsModal}
                >
                  Cerrar
                </button>
              </div>

              <div style={{ padding: 16, maxHeight: '70vh', overflow: 'auto' }}>
                {commentsLoading && <p className="home-msg">Cargando…</p>}
                {commentsError && <p className="home-error">{commentsError}</p>}

                {!commentsLoading && !commentsError && commentsList.length === 0 && (
                  <p className="home-msg">No hay comentarios todavía.</p>
                )}

                {!commentsLoading && commentsList.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {commentsList.map((c) => (
                      <div
                        key={c.id}
                        style={{
                          border: '1px solid #e5e7eb',
                          borderRadius: 14,
                          padding: 12,
                          background: '#f9fafb',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                          <div style={{ fontSize: 11, color: '#6b7280' }}>
                            {formatDateTime(c.created_at)}
                          </div>

                          {(c.actor_username || c.actor_role) && (
                            <div style={{ fontSize: 11, color: '#6b7280' }}>
                              {c.actor_username ? c.actor_username : '—'}
                              {c.actor_role ? ` · ${c.actor_role}` : ''}
                            </div>
                          )}
                        </div>

                        <div style={{ fontSize: 13, fontWeight: 650, color: '#111827', marginTop: 6 }}>
                          {c.comentario}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ padding: 12, borderTop: '1px solid #e5e7eb' }}>
                <p className="home-sub" style={{ margin: 0 }}>
                  Tip: agrega comentarios desde Configuración y aquí verás el historial.
                </p>
              </div>
            </div>
          </div>
        )}

      {/* ===================== */}
{/* HEADER (UNIFICADO) */}
{/* ===================== */}
<AppHeader
  title="COSMOSX"
  subtitle="Buscador"
  user={user ? { username: user.username, role: user.role } : null}
  onClear={clearAllResults}
  onLogout={handleLogout}
/>

        {/* DEBUG BANNER — solo visible si hay error */}
        {(codeError || textError || bulkError || photoError) && (
          <div
            style={{
              background: '#fef3c7',
              border: '1px solid #f59e0b',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 12,
              fontFamily: 'monospace',
              wordBreak: 'break-all',
            }}
          >
            API_BASE = <strong>{API || '(vacío — no configurado)'}</strong>
          </div>
        )}

        {/* ===================== */}
        {/* BUSCAR POR CÓDIGO */}
        {/* ===================== */}
        <section className="home-card">
          <h2 className="home-title" style={{ fontSize: 18 }}>Buscar por código</h2>

          <form onSubmit={handleCodeSearch} className="home-field-block">
            <div className="home-input-row">
              <input
                value={codeQuery}
                onChange={(e) => setCodeQuery(e.target.value)}
                className="input-pill"
                placeholder="25329 o PL/25329/EXP/ES/2024"
              />
              <button className="home-config-btn" style={BTN_PRIMARY} type="submit">
                {codeLoading ? '...' : 'Buscar'}
              </button>
            </div>
          </form>

          {codeError && <p className="home-error">{codeError}</p>}
          {codeResult && (
            <>
              <div style={{ marginTop: 10 }}>{renderResultCard(codeResult)}</div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="home-config-btn"
                  style={BTN_SECONDARY}
                  type="button"
                  onClick={handleResearchCode}
                  disabled={researchLoading}
                >
                  {researchLoading ? 'Investigando…' : 'Investigar PL con IA'}
                </button>
              </div>
            </>
          )}

          {(researchError || researchText) && (
            <div style={{ marginTop: 12, padding: 12, border: '1px solid #e5e7eb', borderRadius: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>Research IA</h3>
              {researchError && <p className="home-sub" style={{ color: '#92400e', marginTop: 8 }}>{researchError}</p>}
              {researchText && <p className="home-sub" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{researchText}</p>}
              {researchSources.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="home-tag" style={{ marginBottom: 6 }}>Fuentes</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {researchSources.slice(0, 10).map((s, i) => (
                      <li key={`${s.url}-${i}`} style={{ marginBottom: 4 }}>
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.title || s.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ===================== */}
        {/* BUSCAR POR TEXTO */}
        {/* ===================== */}
        <section className="home-card">
          <h2 className="home-title" style={{ fontSize: 18 }}>Buscar por razón social / domicilio</h2>

          <form onSubmit={handleTextSearch} className="home-field-block">
            <div className="home-input-row">
              <input
                value={textQuery}
                onChange={(e) => setTextQuery(e.target.value)}
                className="input-pill"
                placeholder="ORSAN, AV. FUNDIDORA…"
              />
              <button className="home-config-btn" style={BTN_PRIMARY} type="submit">
                {textLoading ? '...' : 'Buscar'}
              </button>
            </div>
          </form>

          {textError && <p className="home-error">{textError}</p>}

          {textResults.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {textResults.map(renderResultCard)}
            </div>
          )}
        </section>

        {/* ===================== */}
        {/* LOTE */}
        {/* ===================== */}
        <section className="home-card">
          <h2 className="home-title" style={{ fontSize: 18 }}>Búsqueda en lote</h2>
          <p className="home-sub">Pega una lista (uno por línea). Puedes pegar núcleos o PL completos.</p>

          <form onSubmit={handleBulkSearch} className="bulk-form">
            <textarea
              rows={5}
              className="admin-textarea"
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              placeholder={'PL/6321/EXP/ES/2015\n7420\nPL/7246/EXP/ES/2015\n...'}
            />

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="submit" className="home-config-btn" style={BTN_PRIMARY}>
                {bulkLoading ? `Buscando${bulkDots}` : 'Buscar lista'}
              </button>

              {bulkResults.length > 0 && !bulkLoading && (
                <button type="button" className="home-config-btn" style={BTN_SECONDARY} onClick={downloadBulkCSV}>
                  Descargar CSV
                </button>
              )}
            </div>
          </form>

          {bulkLoading && (
            <p className="home-msg" style={{ marginTop: 8 }}>
              Buscando en la base de datos{bulkDots}
            </p>
          )}

          {bulkError && !bulkLoading && <p className="home-error">{bulkError}</p>}

          {bulkNormCores.length > 0 && !bulkLoading && (
            <>
              <p className="home-msg" style={{ marginTop: 8 }}>
                Se encontraron {bulkResults.length} de {bulkNormCores.length} código(s).
              </p>
              {bulkResults.length > 0 && (
                <p className="home-msg" style={{ marginTop: 4 }}>
                  {bulkByUserSummary}
                </p>
              )}
            </>
          )}

          {bulkNotFound.length > 0 && !bulkLoading && (
            <p className="home-error" style={{ marginTop: 4 }}>
              No se encontraron (núcleos): {bulkNotFound.join(', ')}
            </p>
          )}

          {bulkResults.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {bulkResults.map(renderResultCard)}
            </div>
          )}
        </section>

        {/* ===================== */}
        {/* FOTO */}
        {/* ===================== */}
        <section className="home-card">
          <h2 className="home-title" style={{ fontSize: 18 }}>Buscar desde foto</h2>
          <p className="home-sub">Sube una foto con números o PL/... y el sistema buscará en la base.</p>

          <div className="home-input-row">
            <input
              type="file"
              accept="image/*"
              className="input-pill"
              onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
            />
            <button
              className="home-config-btn"
              style={BTN_PRIMARY}
              type="button"
              onClick={handlePhotoSearch}
              disabled={!imageFile || photoLoading}
            >
              {photoLoading ? 'Leyendo…' : 'Buscar en foto'}
            </button>
          </div>

          {photoError && <p className="home-error" style={{ marginTop: 8 }}>{photoError}</p>}

          {photoCodesRaw.length > 0 && (
            <p className="home-msg" style={{ marginTop: 8 }}>
              OCR detectó {photoCodesRaw.length} línea(s). Se encontraron {photoResults.length}.
            </p>
          )}

          {photoNotFound.length > 0 && (
            <p className="home-error" style={{ marginTop: 4 }}>
              No se encontraron (núcleos): {photoNotFound.join(', ')}
            </p>
          )}

          {photoResults.length > 0 && !photoLoading && (
            <div style={{ marginTop: 10 }}>
              <button type="button" className="home-config-btn" style={BTN_SECONDARY} onClick={downloadPhotoCsv}>
                Descargar CSV
              </button>
            </div>
          )}

          {photoResults.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {photoResults.map(renderResultCard)}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
