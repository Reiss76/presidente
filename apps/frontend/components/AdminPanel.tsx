'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type CodeItem = {
  id: number;
  code: string;
  razon_social?: string | null;
  estado?: string | null;
  municipio?: string | null;
  direccion?: string | null;
  grupo_id?: number | null;
  encargado_actual?: string | null; // Usuario
  encargado_anterior?: string | null; // Sub
  comentario?: string | null; // Comentario (snapshot)
  baja?: boolean | null; // Estado de baja

  //  Calibración
  // "S" = Solicitada (Cal-S)
  // "R" = Realizada (Cal-R)
  calibracion?: string | null;
  m13?: boolean | null;
};

type AuthUser = {
  id: number;
  username: string;
  role: string; // 'admin' | 'editor' (pero llega como string)
};

type AdminPanelProps = {
  currentUser?: AuthUser;
  user?: AuthUser;
  currentUserLegacy?: AuthUser;
};

type ColabRole = 'admin' | 'editor';

type VisitType = 'verificacion' | 'calibracion' | 'supervision' | 'cateo';

type VisitItem = {
  id: number;
  visit_date: string;
  visit_type: VisitType;
  notes?: string | null;
};

type VisitFileItem = {
  id: number;
  file_name: string;
  content_type?: string | null;
  size?: number | null;
  downloadUrl?: string | null;
};

type DocKind = 'general' | 'cal';

type DocItem = {
  id: number;
  file_name: string;
  kind: DocKind;
  content_type?: string | null;
  size?: number | null;
  downloadUrl?: string | null;
};

import { getApiBase } from '../lib/api';

const API = getApiBase();

/** =========================
 *  UI (monocromático en botones)
 *  (NO tocamos colores de indicadores/tarjetas en CSS)
 * ========================= */
const BTN_BLACK: React.CSSProperties = {
  background: '#111827',
  color: '#fff',
  border: '1px solid rgba(0,0,0,0.15)',
};

const BTN_GRAY: React.CSSProperties = {
  background: '#f3f4f6',
  color: '#111827',
  border: '1px solid #e5e7eb',
};

const BTN_DANGER: React.CSSProperties = {
  background: '#fee2e2',
  color: '#991b1b',
  border: '1px solid #fecaca',
};

function calLabel(v?: string | null) {
  if (v === 'S') return 'Cal-S';
  if (v === 'R') return 'Cal-R';
  return '';
}

function safeTrim(v?: string | null) {
  const s = (v ?? '').trim();
  return s.length ? s : null;
}

function hasAssignedUser(v?: string | null) {
  return !!(v && String(v).trim().length > 0);
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    try {
      const txt = await res.text();
      return { message: txt };
    } catch {
      return { message: 'Unknown error' };
    }
  }
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

function formatBytes(bytes?: number | null) {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${sizes[i]}`;
}

export default function AdminPanel(props: AdminPanelProps) {
  const currentUser = props.currentUser || props.user || props.currentUserLegacy;
  const router = useRouter();

  if (!currentUser) {
    return (
      <section className="admin-card">
        Error: AdminPanel no recibió usuario.
      </section>
    );
  }

  const isAdmin: boolean = currentUser.role === 'admin';

  // -----------------------
  // STATE PRINCIPAL (CÓDIGOS)
  // -----------------------
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CodeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // -----------------------
  // ACTUALIZACIÓN MASIVA
  // -----------------------
  const [bulkInput, setBulkInput] = useState('');
  const [bulkResults, setBulkResults] = useState<CodeItem[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const [bulkGrupo, setBulkGrupo] = useState('');
  const [bulkEncargado, setBulkEncargado] = useState('');
  const [bulkSubEncargado, setBulkSubEncargado] = useState('');
  const [bulkComentario, setBulkComentario] = useState('');
  const [bulkCalibracion, setBulkCalibracion] = useState('');
  const [bulkM13, setBulkM13] = useState<'' | 'set' | 'unset'>('');

  // ✅ NUEVO: confirmación para "cambiar usuario" masivamente
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // -----------------------
  // CONFIRMACIÓN M13
  // -----------------------
  const [m13ConfirmOpen, setM13ConfirmOpen] = useState(false);
  const [m13ConfirmAction, setM13ConfirmAction] = useState<'set' | 'unset'>('set');
  const [m13ConfirmScope, setM13ConfirmScope] = useState<'single' | 'bulk'>('single');
  const [m13TargetId, setM13TargetId] = useState<number | null>(null);
  const [m13ConfirmPassword, setM13ConfirmPassword] = useState('');
  const [m13ConfirmError, setM13ConfirmError] = useState<string | null>(null);
  const [m13ConfirmLoading, setM13ConfirmLoading] = useState(false);
  const [m13PendingPassword, setM13PendingPassword] = useState<string | null>(null);

  // -----------------------
  // HERRAMIENTAS RÁPIDAS
  // -----------------------
  const [newGroupName, setNewGroupName] = useState('');
  const [newEncargadoName, setNewEncargadoName] = useState('');
  const [newSubEncargadoName, setNewSubEncargadoName] = useState('');

  const [createdGroups, setCreatedGroups] = useState<string[]>([]);
  const [createdEncargados, setCreatedEncargados] = useState<string[]>([]);

  // -----------------------
  // GESTIÓN COLABORADORES (admin)
  // -----------------------
  const [newColabName, setNewColabName] = useState('');
  const [newColabPass, setNewColabPass] = useState('');
  const [newColabRole, setNewColabRole] = useState<ColabRole>('editor');
  const [colabMsg, setColabMsg] = useState<string | null>(null);
  const [colabError, setColabError] = useState<string | null>(null);

  // -----------------------
  // CATÁLOGOS
  // -----------------------
  const [catalogGroups, setCatalogGroups] = useState<any[]>([]);
  const [catalogEncargados, setCatalogEncargados] = useState<any[]>([]);
  const [catalogSubEncargados, setCatalogSubEncargados] = useState<any[]>([]);

  // -----------------------
  // VISITAS MODAL STATE
  // -----------------------
  const [visitsModal, setVisitsModal] = useState<{
    open: boolean;
    codeId: number | null;
    code: string;
    loading: boolean;
    error: string | null;
    success?: string | null;
    list: VisitItem[];
    addDate: string;
    addType: VisitType;
    addNotes: string;
    addSaving: boolean;
    deletingId: number | null;
  }>({
    open: false,
    codeId: null,
      code: '',
      loading: false,
      error: null,
      success: null,
      list: [],
      addDate: '',
      addType: 'verificacion',
      addNotes: '',
    addSaving: false,
    deletingId: null,
  });

  // -----------------------
  // VISIT FILES MODAL STATE
  // -----------------------
  const [visitFilesModal, setVisitFilesModal] = useState<{
    open: boolean;
    codeId: number | null;
    visitId: number | null;
    visitLabel: string;
    loading: boolean;
    error: string | null;
    list: VisitFileItem[];
    uploading: boolean;
    deletingId: number | null;
    downloadingId: number | null;
  }>({
    open: false,
    codeId: null,
    visitId: null,
    visitLabel: '',
    loading: false,
    error: null,
    list: [],
    uploading: false,
    deletingId: null,
    downloadingId: null,
  });

  // -----------------------
  // DOCUMENTOS MODAL STATE
  // -----------------------
  const [docsModal, setDocsModal] = useState<{
    open: boolean;
    codeId: number | null;
    code: string;
    kind: DocKind;
    loading: boolean;
    error: string | null;
    list: DocItem[];
    uploading: boolean;
    deletingId: number | null;
    downloadingId: number | null;
  }>({
    open: false,
    codeId: null,
    code: '',
    kind: 'general',
    loading: false,
    error: null,
    list: [],
    uploading: false,
    deletingId: null,
    downloadingId: null,
  });

  // -----------------------
  // HERRAMIENTAS RÁPIDAS (GRUPOS / ENCARGADOS)
  // -----------------------
  async function addGroup() {
    const name = newGroupName.trim();
    if (!name) return;

    try {
      const res = await fetch(`${API}/codes/tools/group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);

      const data = await res.json();
      setCreatedGroups((prev) => [data.name, ...prev.slice(0, 4)]);
      setCatalogGroups((prev) => [{ id: data.id, name: data.name }, ...prev]);
      setNewGroupName('');
    } catch (err) {
      console.error(err);
    }
  }

  async function addEncargado() {
    const nombre = newEncargadoName.trim();
    if (!nombre) return;

    try {
      const res = await fetch(`${API}/codes/tools/encargado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ nombre }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);

      const data = await res.json();
      setCreatedEncargados((prev) => [data.nombre, ...prev.slice(0, 4)]);
      setCatalogEncargados((prev) => [{ id: data.id, nombre: data.nombre }, ...prev]);
      setNewEncargadoName('');
    } catch (err) {
      console.error(err);
    }
  }

  async function addSubEncargado() {
    const nombre = newSubEncargadoName.trim();
    if (!nombre) return;

    try {
      const res = await fetch(`${API}/codes/tools/sub-encargado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ nombre }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);

      const data = await res.json();
      setCatalogSubEncargados((prev) => [{ id: data.id, nombre: data.nombre }, ...prev]);
      setNewSubEncargadoName('');
    } catch (err) {
      console.error(err);
    }
  }

  // -----------------------
  // GESTIÓN DE COLABORADORES (SOLO ADMIN)
  // -----------------------
  async function handleCreateColaborador(e: React.FormEvent) {
    e.preventDefault();
    setColabMsg(null);
    setColabError(null);

    const u = newColabName.trim();
    const p = newColabPass.trim();

    if (!u || !p) {
      setColabError('Colaborador y contraseña son obligatorios.');
      return;
    }

    try {
      const res = await fetch(`${API}/codes/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: u, password: p, role: newColabRole }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !(data as any)?.username) {
        setColabError((data as any)?.message || 'No se pudo crear/actualizar el colaborador.');
        return;
      }

      setColabMsg(`Colaborador "${(data as any).username}" creado/actualizado como rol ${(data as any).role}.`);
      setNewColabName('');
      setNewColabPass('');
    } catch (err) {
      console.error(err);
      setColabError('Error al crear colaborador.');
    }
  }

  // -----------------------
  // BUSCAR INDIVIDUAL (CÓDIGOS)
  // -----------------------
  async function search(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setError('Escribe algo para buscar.');
      return;
    }

    const looksLikeCode = /^\d+$/.test(trimmed) || trimmed.toUpperCase().startsWith('PL');

    try {
      setLoading(true);
      setError(null);
      setMessage(null);

      let items: CodeItem[] = [];

      if (looksLikeCode) {
        const core = extractPureCode(trimmed);
        if (!core) throw new Error('Escribe un código válido.');
        const res = await fetch(`${API}/codes/by-code?code=${encodeURIComponent(core)}`, {
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);
        if (data) items = [data as CodeItem];
      } else {
        const res = await fetch(`${API}/codes?query=${encodeURIComponent(trimmed)}`, {
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);
        items = (Array.isArray(data) ? data : (data as any).items || []) as CodeItem[];
      }

      setResults(items);
      if (!items.length) setError(`No se encontraron resultados para "${trimmed}".`);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Ocurrió un error al buscar. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  // -----------------------
  // UPDATE LOCAL / GUARDAR ITEM
  // -----------------------
  function updateLocalField(id: number, field: keyof CodeItem, value: any) {
    setResults((prev) => prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  }

  async function saveItem(item: CodeItem) {
    try {
      setSavingId(item.id);
      setMessage(null);
      setError(null);

      const body: any = {
        encargado_actual: safeTrim(item.encargado_actual),
        encargado_anterior: safeTrim(item.encargado_anterior),
        comentario: safeTrim(item.comentario),
        grupo_id: item.grupo_id != null ? Number(item.grupo_id) : null,
        razon_social: safeTrim(item.razon_social),
        direccion: safeTrim(item.direccion),
        municipio: safeTrim(item.municipio),
        estado: safeTrim(item.estado),
        calibracion: item.calibracion ?? null,
      };

      const res = await fetch(`${API}/codes/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);

      const updated = data as CodeItem;

      setResults((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setMessage(`Cambios guardados para ${updated.code}.`);
    } catch (err) {
      console.error(err);
      setError('No se pudieron guardar los cambios.');
    } finally {
      setSavingId(null);
    }
  }

  // -----------------------
  // NAVIGATION HANDLERS (Ahora modales)
  // -----------------------
  function openVisitas(item: CodeItem) {
    setVisitsModal((prev) => ({
      ...prev,
      open: true,
      codeId: item.id,
      code: item.code,
      loading: true,
      error: null,
      success: null,
      list: [],
    }));
    loadVisits(item.id);
  }

  function openDocumentos(item: CodeItem, kind: DocKind = 'general') {
    setDocsModal((prev) => ({
      ...prev,
      open: true,
      codeId: item.id,
      code: item.code,
      kind,
      loading: true,
      error: null,
      list: [],
    }));
    loadDocs(item.id, kind);
  }

  // -----------------------
  // BAJA CONTROLS
  // -----------------------
  const [bajaActionId, setBajaActionId] = useState<number | null>(null);

  async function toggleBaja(item: CodeItem, newBajaValue: boolean) {
    try {
      setBajaActionId(item.id);
      setError(null);
      setMessage(null);

      const res = await fetch(`${API}/codes/${item.id}/baja`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ baja: newBajaValue }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);

      // Update local state
      setResults((prev) => 
        prev.map((r) => (r.id === item.id ? { ...r, baja: newBajaValue } : r))
      );
      
      setMessage(`${newBajaValue ? 'Dado de baja' : 'Baja removida'} para ${item.code}.`);
    } catch (err) {
      console.error(err);
      setError(`No se pudo ${newBajaValue ? 'dar de baja' : 'quitar baja'} el código.`);
    } finally {
      setBajaActionId(null);
    }
  }

  // -----------------------
  // BÚSQUEDA MASIVA (CÓDIGOS)
  // -----------------------
  async function bulkLookup(e: React.FormEvent) {
    e.preventDefault();
    const lines = bulkInput
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const normalized = normalizeCodes(lines);

    if (!normalized.length) {
      setBulkResults([]);
      setResults([]);
      setBulkError('Pega al menos un código.');
      return;
    }

    try {
      setBulkError(null);
      setBulkMessage(null);
      setBulkSaving(true);

      const res = await fetch(`${API}/codes/bulk-lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ codes: normalized }),
      });

      const data = await safeJson(res);
      if (!res.ok) {
        const message = (data as any)?.message || `Error ${res.status}`;
        setBulkError(message);
        setResults([]);
        setBulkResults([]);
        return;
      }

      const arr = Array.isArray(data)
        ? (data as CodeItem[])
        : Array.isArray((data as any)?.items)
          ? ((data as any).items as CodeItem[])
          : [];
      setBulkResults(arr);
      setResults(arr);

      if (!arr.length) setBulkError('Ninguno de los códigos pegados fue encontrado.');
    } catch (err: any) {
      console.error(err);
      setBulkError(err?.message || 'Error al buscar la lista. Intenta de nuevo.');
      setResults([]);
    } finally {
      setBulkSaving(false);
    }
  }

  // ✅ Fix: no enviar nulls si no quieres cambiar algo
  const bulkBody = useMemo(() => {
    const body: any = { ids: bulkResults.map((r) => r.id) };

    if (bulkGrupo) body.grupo_id = Number(bulkGrupo);
    if (bulkEncargado) body.encargado_actual = bulkEncargado;
    if (bulkSubEncargado) body.encargado_anterior = bulkSubEncargado;
    if (bulkComentario.trim()) body.comentario = bulkComentario.trim();
    if (bulkCalibracion) body.calibracion = bulkCalibracion;
    if (bulkM13 === 'set') body.m13 = true;
    else if (bulkM13 === 'unset') body.m13 = false;

    return body;
  }, [bulkResults, bulkGrupo, bulkEncargado, bulkSubEncargado, bulkComentario, bulkCalibracion, bulkM13]);

  function openConfirmIfNeeded(): boolean {
    // Solo se dispara si vas a cambiar USUARIO masivamente.
    if (!bulkEncargado) {
      console.log('[AdminPanel] openConfirmIfNeeded: no hay bulkEncargado');
      return false;
    }

    // Si la lista contiene códigos con usuario asignado distinto al nuevo, pedimos confirmación.
    const target = bulkEncargado.trim();
    const hasConflicts = bulkResults.some((r) => {
      const cur = (r.encargado_actual ?? '').trim();
      return cur.length > 0 && cur !== target;
    });

    console.log('[AdminPanel] openConfirmIfNeeded:', {
      target,
      hasConflicts,
      codesWithUsers: bulkResults.filter(r => (r.encargado_actual ?? '').trim().length > 0).length,
      totalCodes: bulkResults.length
    });

    if (!hasConflicts) return false;

    // Abre modal
    setConfirmPassword('');
    setConfirmError(null);
    setConfirmOpen(true);
    return true;
  }

  async function bulkApply(forceUserChange: boolean, authPassword?: string, m13AuthPassword?: string): Promise<boolean> {
    if (!bulkResults.length) {
      setBulkError('Primero busca la lista.');
      return false;
    }

    if (!bulkGrupo && !bulkEncargado && !bulkSubEncargado && !bulkComentario.trim() && !bulkCalibracion && !bulkM13) {
      setBulkError('Ingresa Grupo, Usuario, Sub, Comentario, Calibración o M13.');
      return false;
    }

    try {
      setBulkSaving(true);
      setBulkError(null);
      setBulkMessage(null);

      const finalBody: any = { ...bulkBody };

      if (bulkM13) {
        finalBody.force_m13_change = true;
      }

      // ✅ Override controlado (solo cuando confirmas)
      if (forceUserChange) {
        finalBody.force_user_change = true;
        if (currentUser) {
          finalBody.actor = { username: currentUser.username };
        }
      }

      const authToSend = authPassword || m13AuthPassword;
      if (authToSend) {
        finalBody.auth_password = authToSend;
      }

      // Debug: log what we're sending
      console.log('[AdminPanel] Enviando bulk-update:', {
        forceUserChange,
        hasAuthPassword: !!authPassword,
        bodyKeys: Object.keys(finalBody),
        encargado_actual: finalBody.encargado_actual,
        force_user_change: finalBody.force_user_change,
        idsCount: finalBody.ids?.length
      });

      const res = await fetch(`${API}/codes/bulk-update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(finalBody),
      });

      const data = await res.json().catch(() => ({}));
      
      // Debug: log what backend returned
      console.log('[AdminPanel] Respuesta bulk-update:', {
        status: res.status,
        ok: res.ok,
        updatedCount: (data as any).updated?.length || 0,
        skippedCount: (data as any).skipped?.length || 0,
        skippedDetails: (data as any).skipped,
      });
      
      // Manejo especial de error 401/403 para contraseña incorrecta
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          const errorMsg = (data as any)?.message || 'Contraseña incorrecta.';
          if (forceUserChange) {
            setConfirmError(errorMsg);
          } else {
            setBulkError(errorMsg);
          }
          return false;
        }
        throw new Error((data as any)?.message || 'Error al aplicar cambios');
      }

      const updated: CodeItem[] = (data as any).updated || [];
      const skipped = (data as any).skipped || [];

      const updatedMap = new Map(updated.map((u: CodeItem) => [u.id, u]));

      setResults((prev) => prev.map((p) => updatedMap.get(p.id) ?? p));
      setBulkResults(updated);

      if (updated.length) setBulkMessage(`Cambios aplicados a ${updated.length} código(s).`);
      else setBulkMessage(null);

      // Si NO forzaste, backend puede "skipppear" por usuario existente.
      // Si forzaste y aun así hay skipped, lo mostramos igual.
      if (skipped.length) {
        const detalle = skipped
          .map((s: any) => `${s.code} (usuario actual: ${s.encargado_actual?.trim() ? s.encargado_actual : '—'})`)
          .join(', ');

        setBulkError(
          forceUserChange
            ? `Algunos no se actualizaron incluso con override: ${detalle}`
            : `Los siguientes no se actualizaron porque ya tienen usuario asignado: ${detalle}`,
        );
        return false;
      }

      return true;
    } catch (err: any) {
      console.error(err);
      const errorMsg = err?.message || 'No se pudieron aplicar cambios.';
      if (forceUserChange) {
        setConfirmError(errorMsg);
      } else {
        setBulkError(errorMsg);
      }
      return false;
    } finally {
      setBulkSaving(false);
    }
  }

  async function onClickBulkApply() {
    console.log('[AdminPanel] onClickBulkApply ejecutado', {
      hasBulkEncargado: !!bulkEncargado,
      bulkEncargado,
      bulkResultsCount: bulkResults.length
    });

    if (bulkM13) {
      setBulkError('Usa los botones de M13 para aplicar ese cambio con confirmación.');
      return;
    }

    // 1) Si detecta cambio de usuario con conflictos -> modal
    if (openConfirmIfNeeded()) {
      console.log('[AdminPanel] Se detectaron conflictos, abriendo modal');
      return;
    }

    console.log('[AdminPanel] No hay conflictos, aplicando sin force');
    // 2) Si no hay conflicto o no hay usuario -> apply normal
    await bulkApply(false);
  }

  async function confirmOverride() {
    const pw = confirmPassword.trim();
    if (!pw) {
      setConfirmError('Escribe tu contraseña para confirmar.');
      return;
    }

    console.log('[AdminPanel] confirmOverride ejecutado, llamando bulkApply con force=true');

    try {
      setConfirmLoading(true);
      setConfirmError(null);

      const success = await bulkApply(true, pw, m13PendingPassword || undefined);

      // Solo cerrar modal si fue exitoso
      if (success) {
        setConfirmOpen(false);
        setConfirmPassword('');
        setM13PendingPassword(null);
        console.log('[AdminPanel] confirmOverride exitoso, modal cerrado');
      } else {
        console.log('[AdminPanel] confirmOverride falló, modal permanece abierto');
      }
    } catch (e: any) {
      setConfirmError(e?.message || 'No se pudo confirmar.');
      console.error('[AdminPanel] confirmOverride error:', e);
    } finally {
      setConfirmLoading(false);
    }
  }

  function cancelOverride() {
    setConfirmOpen(false);
    setConfirmPassword('');
    setConfirmError(null);
    setM13PendingPassword(null);
  }

  // -----------------------
  // M13 HANDLERS
  // -----------------------
  function openM13ModalForItem(item: CodeItem, value: boolean) {
    if (!currentUser) return;
    setM13ConfirmScope('single');
    setM13ConfirmAction(value ? 'set' : 'unset');
    setM13TargetId(item.id);
    setM13ConfirmPassword('');
    setM13ConfirmError(null);
    setM13PendingPassword(null);
    setM13ConfirmOpen(true);
  }

  function openBulkM13(action: 'set' | 'unset') {
    if (!bulkResults.length) {
      setBulkError('Primero busca la lista.');
      return;
    }
    setBulkM13(action);
    setM13ConfirmScope('bulk');
    setM13ConfirmAction(action);
    setM13TargetId(null);
    setM13ConfirmPassword('');
    setM13ConfirmError(null);
    setM13PendingPassword(null);
    setM13ConfirmOpen(true);
  }

  function cancelM13Confirm() {
    setM13ConfirmOpen(false);
    setM13ConfirmPassword('');
    setM13ConfirmError(null);
    setM13ConfirmLoading(false);
    setM13PendingPassword(null);
    setBulkM13('');
  }

  async function confirmM13Action() {
    const pw = m13ConfirmPassword.trim();
    if (!pw) {
      setM13ConfirmError('Escribe tu contraseña para confirmar.');
      return;
    }

    if (m13ConfirmScope === 'bulk' && !bulkResults.length) {
      setM13ConfirmError('Primero busca la lista.');
      return;
    }

    if (m13ConfirmScope === 'single' && !m13TargetId) {
      cancelM13Confirm();
      return;
    }

    const desired = m13ConfirmAction === 'set';

    try {
      setM13ConfirmLoading(true);
      setM13ConfirmError(null);
      setM13PendingPassword(pw);

      if (m13ConfirmScope === 'single' && m13TargetId) {
        const res = await fetch(`${API}/codes/${m13TargetId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            m13: desired,
            auth_password: pw,
            actor: currentUser ? { username: currentUser.username } : undefined,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);

        const updated = data as CodeItem;
        setResults((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        setBulkResults((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        setMessage(`M13 ${desired ? 'activado' : 'quitado'} para ${updated.code}.`);
        cancelM13Confirm();
        return;
      }

      // BULK
      const success = await bulkApply(false, undefined, pw);
      if (success) {
        cancelM13Confirm();
        setM13PendingPassword(null);
        setBulkM13('');
      }
    } catch (err: any) {
      console.error(err);
      setM13ConfirmError(err?.message || 'No se pudo aplicar M13.');
    } finally {
      setM13ConfirmLoading(false);
    }
  }

  // -----------------------
  // BULK BAJA
  // -----------------------
  async function bulkSetBaja(value: boolean) {
    if (!bulkResults.length) {
      setBulkError('Primero busca la lista.');
      return;
    }

    try {
      setBulkSaving(true);
      setBulkError(null);
      setBulkMessage(null);

      const ids = bulkResults.map((r) => r.id);

      const res = await fetch(`${API}/codes/bulk-baja`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids, baja: value }),
      });

      let data: unknown;
      try {
        data = await res.json();
      } catch {
        throw new Error(`Error al procesar respuesta del servidor (${res.status})`);
      }

      if (!res.ok) {
        const errorMessage = 
          typeof data === 'object' && data !== null && 'message' in data
            ? String((data as any).message)
            : `Error ${res.status}`;
        throw new Error(errorMessage);
      }

      // Backend puede devolver { updated: [...] } o directamente una lista
      let updated: CodeItem[] = [];
      if (typeof data === 'object' && data !== null) {
        if ('updated' in data && Array.isArray((data as any).updated)) {
          updated = (data as any).updated as CodeItem[];
        } else if (Array.isArray(data)) {
          updated = data as CodeItem[];
        }
      }

      if (updated.length > 0) {
        const updatedMap = new Map(updated.map((u: CodeItem) => [u.id, u]));
        
        setResults((prev) => prev.map((p) => updatedMap.get(p.id) ?? p));
        setBulkResults(updated);
        
        setBulkMessage(`${value ? 'BAJA aplicada' : 'BAJA removida'} a ${updated.length} código(s).`);
      } else {
        setBulkMessage('No se actualizaron códigos.');
      }
    } catch (err: any) {
      console.error(err);
      setBulkError(err?.message || `No se pudo ${value ? 'aplicar' : 'quitar'} BAJA.`);
    } finally {
      setBulkSaving(false);
    }
  }

  // -----------------------
  // CARGAR CATÁLOGOS
  // -----------------------
  useEffect(() => {
    async function load() {
      try {
        // Endpoint principal (backend nuevo)
        let groups: Array<{ id: number; name: string }> = [];
        let encargados: Array<{ id: number; nombre: string }> = [];
        let subEncargados: Array<{ id: number; nombre: string }> = [];

        const primaryRes = await fetch(`${API}/codes/tools/catalogs`, { credentials: 'include' });

        if (primaryRes.ok) {
          const data = await primaryRes.json();
          groups = (data as any).groups || [];
          encargados = (data as any).encargados || [];
          subEncargados = (data as any).subEncargados || [];
        } else if (primaryRes.status === 404) {
          // Fallback (backend anterior): /codes/assigned/catalogs
          const fallbackRes = await fetch(`${API}/codes/assigned/catalogs`, {
            credentials: 'include',
          });

          if (fallbackRes.ok) {
            const fallbackData = await fallbackRes.json();

            const users = Array.isArray((fallbackData as any).users)
              ? ((fallbackData as any).users as string[])
              : [];
            const subs = Array.isArray((fallbackData as any).subs)
              ? ((fallbackData as any).subs as string[])
              : [];

            encargados = users.map((nombre, idx) => ({ id: idx + 1, nombre }));
            subEncargados = subs.map((nombre, idx) => ({ id: idx + 1, nombre }));
          }

          // Grupos vienen mejor de /codes/groups (existe en ambos backends)
          const groupsRes = await fetch(`${API}/codes/groups`, { credentials: 'include' });
          if (groupsRes.ok) {
            const groupsData = await groupsRes.json();
            groups = Array.isArray(groupsData) ? groupsData : [];
          }
        }

        setCatalogGroups(groups);
        setCatalogEncargados(encargados);
        setCatalogSubEncargados(subEncargados);
      } catch (err) {
        console.error(err);
      }
    }
    load();
  }, []);

  // -----------------------
  // VISITAS HELPERS
  // -----------------------
  async function loadVisits(codeId: number) {
    setVisitsModal((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(`${API}/codes/${codeId}/visits`, { credentials: 'include' });
      const data = await safeJson(res);
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);
      const list = Array.isArray((data as any)?.items)
        ? ((data as any).items as VisitItem[])
        : Array.isArray(data)
          ? (data as VisitItem[])
          : [];
      setVisitsModal((prev) => ({ ...prev, list, loading: false }));
    } catch (err: any) {
      console.error(err);
      setVisitsModal((prev) => ({ ...prev, loading: false, error: err?.message || 'No se pudieron cargar visitas' }));
    }
  }

  async function addVisit() {
    if (!visitsModal.codeId) return;
    const visit_date = visitsModal.addDate.trim();
    if (!visit_date) {
      setVisitsModal((prev) => ({ ...prev, error: 'La fecha es obligatoria.', success: null }));
      return;
    }
    try {
      setVisitsModal((prev) => ({ ...prev, addSaving: true, error: null, success: null }));
      const body = { visit_date, visit_type: visitsModal.addType, notes: visitsModal.addNotes?.trim() || undefined };
      const res = await fetch(`${API}/codes/${visitsModal.codeId}/visits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);
      setVisitsModal((prev) => ({
        ...prev,
        addDate: '',
        addNotes: '',
        success: '✅ Visita agregada',
      }));
      await loadVisits(visitsModal.codeId);
    } catch (err: any) {
      console.error(err);
      setVisitsModal((prev) => ({ ...prev, error: err?.message || 'No se pudo agregar visita', success: null }));
    } finally {
      setVisitsModal((prev) => ({ ...prev, addSaving: false }));
    }
  }

  async function deleteVisit(visitId: number) {
    if (!isAdmin || !visitsModal.codeId) return;
    try {
      setVisitsModal((prev) => ({ ...prev, deletingId: visitId, error: null }));
      const res = await fetch(`${API}/codes/${visitsModal.codeId}/visits/${visitId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);
      await loadVisits(visitsModal.codeId);
    } catch (err: any) {
      console.error(err);
      setVisitsModal((prev) => ({ ...prev, error: err?.message || 'No se pudo eliminar visita' }));
    } finally {
      setVisitsModal((prev) => ({ ...prev, deletingId: null }));
    }
  }

  function closeVisitsModal() {
    setVisitsModal((prev) => ({
      ...prev,
      open: false,
      codeId: null,
      list: [],
      error: null,
      addDate: '',
      addNotes: '',
      addSaving: false,
      loading: false,
      success: null,
    }));
  }

  // -----------------------
  // VISIT FILES HELPERS
  // -----------------------
  function openVisitFiles(visit: VisitItem) {
    if (!visitsModal.codeId) return;
    setVisitFilesModal({
      open: true,
      codeId: visitsModal.codeId,
      visitId: visit.id,
      visitLabel: `${visitsModal.code} • ${visit.visit_date}`,
      loading: true,
      error: null,
      list: [],
      uploading: false,
      deletingId: null,
      downloadingId: null,
    });
    loadVisitFiles(visitsModal.codeId, visit.id);
  }

  function closeVisitFilesModal() {
    setVisitFilesModal({
      open: false,
      codeId: null,
      visitId: null,
      visitLabel: '',
      loading: false,
      error: null,
      list: [],
      uploading: false,
      deletingId: null,
      downloadingId: null,
    });
  }

  async function loadVisitFiles(codeId: number, visitId: number) {
    setVisitFilesModal((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(`${API}/codes/${codeId}/visits/${visitId}/files`, { credentials: 'include' });
      const data = await safeJson(res);
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);
      const rawList = Array.isArray((data as any)?.items)
        ? (data as any).items
        : Array.isArray(data)
          ? data
          : [];
      const list = (rawList as any[]).map((x) => ({
        id: x.id,
        file_name: x.file_name ?? x.fileName ?? 'archivo',
        content_type: x.content_type ?? x.contentType ?? null,
        size: x.size != null ? Number(x.size) : null,
        downloadUrl: x.downloadUrl ?? null,
      })) as VisitFileItem[];
      setVisitFilesModal((prev) => ({ ...prev, loading: false, list }));
    } catch (err: any) {
      console.error(err);
      setVisitFilesModal((prev) => ({ ...prev, loading: false, error: err?.message || 'No se pudieron cargar archivos' }));
    }
  }

  async function uploadVisitFile(file: File) {
    if (!visitFilesModal.codeId || !visitFilesModal.visitId) return;
    const codeId = visitFilesModal.codeId;
    const visitId = visitFilesModal.visitId;
    let tempFileId: number | string | null = null;

    try {
      setVisitFilesModal((prev) => ({ ...prev, uploading: true, error: null }));
      const presignRes = await fetch(`${API}/codes/${codeId}/visits/${visitId}/files/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
        }),
      });
      const presignData = await safeJson(presignRes);
      if (!presignRes.ok) throw new Error((presignData as any)?.message || `Error ${presignRes.status}`);

      const uploadUrl =
        (presignData as any).uploadUrl ||
        (presignData as any).url ||
        (presignData as any).signedUrl;
      tempFileId = (presignData as any).fileId || (presignData as any).file_id || (presignData as any).id || null;

      if (!uploadUrl) throw new Error('No se recibió URL de carga');

      const putRes = await fetch(uploadUrl as string, {
        method: 'PUT',
        body: file,
      });
      if (!putRes.ok) throw new Error(`Error al subir archivo (${putRes.status})`);

      await loadVisitFiles(codeId, visitId);
    } catch (err: any) {
      console.error(err);
      if (tempFileId) {
        try {
          await fetch(`${API}/codes/${codeId}/visits/${visitId}/files/${tempFileId}`, {
            method: 'DELETE',
            credentials: 'include',
          });
        } catch (cleanupErr) {
          console.error('No se pudo limpiar archivo fallido', cleanupErr);
        }
      }
      setVisitFilesModal((prev) => ({ ...prev, error: err?.message || 'No se pudo subir archivo' }));
    } finally {
      setVisitFilesModal((prev) => ({ ...prev, uploading: false }));
    }
  }

  async function deleteVisitFile(fileId: number) {
    if (!isAdmin || !visitFilesModal.codeId || !visitFilesModal.visitId) return;
    const codeId = visitFilesModal.codeId;
    const visitId = visitFilesModal.visitId;
    try {
      setVisitFilesModal((prev) => ({ ...prev, deletingId: fileId, error: null }));
      const res = await fetch(`${API}/codes/${codeId}/visits/${visitId}/files/${fileId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);
      await loadVisitFiles(codeId, visitId);
    } catch (err: any) {
      console.error(err);
      setVisitFilesModal((prev) => ({ ...prev, error: err?.message || 'No se pudo eliminar archivo' }));
    } finally {
      setVisitFilesModal((prev) => ({ ...prev, deletingId: null }));
    }
  }

  async function downloadVisitFile(file: VisitFileItem) {
    if (!visitFilesModal.codeId || !visitFilesModal.visitId || !file.id) return;
    const codeId = visitFilesModal.codeId;
    const visitId = visitFilesModal.visitId;
    const endpoint = `${API}/codes/${codeId}/visits/${visitId}/files/${file.id}/download`;
    const url = file.downloadUrl || endpoint;
    try {
      setVisitFilesModal((prev) => ({ ...prev, downloadingId: file.id, error: null }));
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = file.file_name || 'archivo';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err: any) {
      console.error(err);
      setVisitFilesModal((prev) => ({ ...prev, error: err?.message || 'No se pudo descargar archivo' }));
    } finally {
      setVisitFilesModal((prev) => ({ ...prev, downloadingId: null }));
    }
  }

  // -----------------------
  // DOCUMENTOS HELPERS
  // -----------------------
  function closeDocsModal() {
    setDocsModal({
      open: false,
      codeId: null,
      code: '',
      kind: 'general',
      loading: false,
      error: null,
      list: [],
      uploading: false,
      deletingId: null,
      downloadingId: null,
    });
  }

  async function loadDocs(codeId: number, kind: DocKind) {
    setDocsModal((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(`${API}/codes/${codeId}/files?kind=${encodeURIComponent(kind)}`, {
        credentials: 'include',
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);
      const list = Array.isArray(data) ? (data as DocItem[]) : [];
      setDocsModal((prev) => ({ ...prev, loading: false, list }));
    } catch (err: any) {
      console.error(err);
      setDocsModal((prev) => ({ ...prev, loading: false, error: err?.message || 'No se pudieron cargar documentos' }));
    }
  }

  async function uploadDoc(file: File) {
    if (!docsModal.codeId) return;
    const codeId = docsModal.codeId;
    let tempFileId: number | string | null = null;
    try {
      setDocsModal((prev) => ({ ...prev, uploading: true, error: null }));
      const presignRes = await fetch(`${API}/codes/${codeId}/files/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          kind: docsModal.kind,
        }),
      });
      const presignData = await safeJson(presignRes);
      if (!presignRes.ok) throw new Error((presignData as any)?.message || `Error ${presignRes.status}`);

      const uploadUrl =
        (presignData as any).uploadUrl ||
        (presignData as any).url ||
        (presignData as any).signedUrl;
      tempFileId = (presignData as any).fileId || (presignData as any).file_id || (presignData as any).id || null;

      if (!uploadUrl) throw new Error('No se recibió URL de carga');

      const putRes = await fetch(uploadUrl as string, {
        method: 'PUT',
        body: file,
      });
      if (!putRes.ok) throw new Error(`Error al subir archivo (${putRes.status})`);

      await loadDocs(codeId, docsModal.kind);
    } catch (err: any) {
      console.error(err);
      if (tempFileId) {
        try {
          await fetch(`${API}/codes/${codeId}/files/${tempFileId}`, {
            method: 'DELETE',
            credentials: 'include',
          });
        } catch (cleanupErr) {
          console.error('No se pudo limpiar archivo fallido', cleanupErr);
        }
      }
      setDocsModal((prev) => ({ ...prev, error: err?.message || 'No se pudo subir documento' }));
    } finally {
      setDocsModal((prev) => ({ ...prev, uploading: false }));
    }
  }

  async function deleteDoc(fileId: number) {
    if (!isAdmin || !docsModal.codeId) return;
    const codeId = docsModal.codeId;
    try {
      setDocsModal((prev) => ({ ...prev, deletingId: fileId, error: null }));
      const res = await fetch(`${API}/codes/${codeId}/files/${fileId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);
      await loadDocs(codeId, docsModal.kind);
    } catch (err: any) {
      console.error(err);
      setDocsModal((prev) => ({ ...prev, error: err?.message || 'No se pudo eliminar documento' }));
    } finally {
      setDocsModal((prev) => ({ ...prev, deletingId: null }));
    }
  }

  async function downloadDoc(doc: DocItem) {
    if (!docsModal.codeId || !doc.id) return;
    const codeId = docsModal.codeId;
    const endpoint = `${API}/codes/${codeId}/files/${doc.id}/download`;
    const url = doc.downloadUrl || endpoint;
    try {
      setDocsModal((prev) => ({ ...prev, downloadingId: doc.id, error: null }));
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = doc.file_name || 'documento';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err: any) {
      console.error(err);
      setDocsModal((prev) => ({ ...prev, error: err?.message || 'No se pudo descargar documento' }));
    } finally {
      setDocsModal((prev) => ({ ...prev, downloadingId: null }));
    }
  }

  // -----------------------
  // UI
  // -----------------------
  function m13ModalTitle() {
    if (m13ConfirmScope === 'bulk') {
      const count = bulkResults.length;
      const label = count === 1 ? 'código' : 'códigos';
      return `${m13ConfirmAction === 'set' ? 'Aplicar' : 'Quitar'} M13 a ${count} ${label}`;
    }
    return m13ConfirmAction === 'set' ? '¿Aplicar M13?' : '¿Quitar M13?';
  }

  return (
    <>
      {/* =======================
          MODAL CONFIRMACIÓN OVERRIDE
      ======================= */}
      {confirmOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={cancelOverride}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 520,
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
                <div className="admin-tag">COSMOSX</div>
                <div style={{ fontSize: 14, fontWeight: 900, marginTop: 2 }}>
                  Confirmar cambio masivo de Usuario
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  Estás por sobrescribir el Usuario en códigos que ya tenían uno asignado.
                </div>
              </div>

              <button type="button" className="home-config-btn" style={BTN_BLACK} onClick={cancelOverride}>
                Cerrar
              </button>
            </div>

            <div style={{ padding: 16 }}>
              <p style={{ margin: 0, fontSize: 13, color: '#111827', fontWeight: 650 }}>
                Nuevo Usuario: <strong>{bulkEncargado || '—'}</strong>
              </p>

              <p style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
                Para continuar, escribe la contraseña del usuario loggeado (<strong>{currentUser.username}</strong>).
              </p>

              <input
                type="password"
                className="admin-input admin-input-rect"
                placeholder="Contraseña"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={{ marginTop: 8 }}
              />

              {confirmError && (
                <p className="admin-status admin-status-error" style={{ marginTop: 10 }}>
                  {confirmError}
                </p>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button type="button" className="home-config-btn" style={BTN_GRAY} onClick={cancelOverride} disabled={confirmLoading}>
                  Cancelar
                </button>

                <button type="button" className="home-config-btn" style={BTN_BLACK} onClick={confirmOverride} disabled={confirmLoading}>
                  {confirmLoading ? 'Confirmando…' : 'Confirmar'}
                </button>
              </div>
            </div>

            <div style={{ padding: 12, borderTop: '1px solid #e5e7eb' }}>
              <p className="home-sub" style={{ margin: 0 }}>
                Tip: si tu contraseña es incorrecta, el backend debe regresar error y aquí lo verás.
              </p>
            </div>
          </div>
        </div>
      )}

      {m13ConfirmOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={cancelM13Confirm}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 520,
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
                <div className="admin-tag">M13</div>
                <div style={{ fontSize: 14, fontWeight: 900, marginTop: 2 }}>{m13ModalTitle()}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  {m13ConfirmScope === 'bulk'
                    ? 'Acción masiva sobre la lista cargada.'
                    : `Código ID: ${m13TargetId ?? '—'}`}
                </div>
              </div>

              <button type="button" className="home-config-btn" style={BTN_BLACK} onClick={cancelM13Confirm}>
                Cerrar
              </button>
            </div>

            <div style={{ padding: 16 }}>
              <p style={{ margin: 0, fontSize: 13, color: '#111827', fontWeight: 650 }}>
                {m13ConfirmScope === 'bulk'
                  ? `¿Está seguro que desea ${m13ConfirmAction === 'set' ? 'aplicar' : 'quitar'} M13 a ${bulkResults.length} código${bulkResults.length === 1 ? '' : 's'}?`
                  : 'Confirme el cambio de M13 para este código.'}
              </p>

              <p style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                Escribe la contraseña del usuario logueado{' '}
                {currentUser?.username ? (
                  <strong>{currentUser.username}</strong>
                ) : (
                  <strong>actual</strong>
                )}
                .
              </p>

              <input
                type="password"
                className="admin-input admin-input-rect"
                placeholder="Contraseña"
                value={m13ConfirmPassword}
                onChange={(e) => setM13ConfirmPassword(e.target.value)}
                style={{ marginTop: 8 }}
              />

              {m13ConfirmError && (
                <p className="admin-status admin-status-error" style={{ marginTop: 10 }}>
                  {m13ConfirmError}
                </p>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button type="button" className="home-config-btn" style={BTN_GRAY} onClick={cancelM13Confirm} disabled={m13ConfirmLoading}>
                  Cancelar
                </button>

                <button type="button" className="home-config-btn" style={BTN_BLACK} onClick={confirmM13Action} disabled={m13ConfirmLoading}>
                  {m13ConfirmLoading ? 'Confirmando…' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ✅ IMPORTANTE:
          Este AdminPanel NO debe renderizar header de menú.
          El menú unificado ya va en app/admin/page.tsx con AppHeader.
      */}

      {/* GESTIÓN DE COLABORADORES (solo admins) */}
      {isAdmin && (
        <section className="admin-card">
          <h2 className="admin-list-title">Colaboradores</h2>
          <p className="admin-note">
            Solo los Administradores pueden crear Colaboradores.
          </p>

          <form
            onSubmit={handleCreateColaborador}
            style={{
              marginTop: 12,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              alignItems: 'center',
            }}
          >
            <input
              className="admin-input admin-input-pill"
              style={{ minWidth: 160, flex: '1 1 160px' }}
              placeholder="Colaborador (usuario)"
              value={newColabName}
              onChange={(e) => setNewColabName(e.target.value)}
            />
            <input
              className="admin-input admin-input-pill"
              style={{ minWidth: 160, flex: '1 1 160px' }}
              type="password"
              placeholder="Contraseña"
              value={newColabPass}
              onChange={(e) => setNewColabPass(e.target.value)}
            />
            <select
              className="admin-select admin-input-pill"
              style={{ minWidth: 160 }}
              value={newColabRole}
              onChange={(e) => setNewColabRole(e.target.value === 'admin' ? 'admin' : 'editor')}
            >
              <option value="editor">Editor</option>
              <option value="admin">Administrador</option>
            </select>

            <button type="submit" className="home-config-btn" style={BTN_BLACK}>
              Guardar
            </button>
          </form>

          {colabMsg && <p className="admin-status admin-status-ok" style={{ marginTop: 8 }}>{colabMsg}</p>}
          {colabError && <p className="admin-status admin-status-error" style={{ marginTop: 8 }}>{colabError}</p>}
        </section>
      )}

      {/* HERRAMIENTAS RÁPIDAS */}
      <section className="admin-card admin-tools">
        <div className="admin-tools-grid">
          <div className="admin-tools-col">
            <div className="admin-label">Crear grupo</div>
            <div className="admin-input-row">
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Ej. 2000"
                className="admin-input admin-input-pill"
              />
              <button type="button" className="home-config-btn" style={BTN_BLACK} onClick={addGroup}>
                Agregar
              </button>
            </div>
            {createdGroups.length > 0 && <p className="admin-note">Últimos: {createdGroups.join(', ')}</p>}
          </div>

          <div className="admin-tools-col">
            <div className="admin-label">Crear usuario</div>
            <div className="admin-input-row">
              <input
                value={newEncargadoName}
                onChange={(e) => setNewEncargadoName(e.target.value)}
                placeholder="Ej. POL"
                className="admin-input admin-input-pill"
              />
              <button type="button" className="home-config-btn" style={BTN_BLACK} onClick={addEncargado}>
                Agregar
              </button>
            </div>
            {createdEncargados.length > 0 && <p className="admin-note">Últimos: {createdEncargados.join(', ')}</p>}
          </div>

          <div className="admin-tools-col">
            <div className="admin-label">Crear sub usuario</div>
            <div className="admin-input-row">
              <input
                value={newSubEncargadoName}
                onChange={(e) => setNewSubEncargadoName(e.target.value)}
                placeholder="Ej. LS"
                className="admin-input admin-input-pill"
              />
              <button type="button" className="home-config-btn" style={BTN_BLACK} onClick={addSubEncargado}>
                Agregar
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* BUSCADOR */}
      <section className="admin-card admin-search">
        <form className="admin-search-row" onSubmit={search}>
          <input
            placeholder="Buscar por código, razón social o dirección…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="admin-input admin-input-search"
          />
          <button type="submit" className="home-config-btn" style={BTN_BLACK}>
            {loading ? 'Buscando…' : 'Buscar'}
          </button>
        </form>

        {error && <p className="admin-status admin-status-error">{error}</p>}
        {message && !error && <p className="admin-status admin-status-ok">{message}</p>}
      </section>

      {/* MASIVO */}
      <section className="admin-card admin-mass">
        <div className="admin-mass-header">
          <div>
            <div className="admin-label">Actualización masiva</div>
            <p className="admin-note">
              Pega códigos (uno por línea) y aplica cambios a todos.
              <br />
              Si cambias <strong>Usuario</strong> y ya tenían uno, pedirá confirmación + contraseña.
            </p>
          </div>
        </div>

        <form className="admin-mass-grid" onSubmit={bulkLookup}>
          <textarea
            value={bulkInput}
            onChange={(e) => setBulkInput(e.target.value)}
            placeholder={'Ej.\nPL/22341/EXP/ES/2015\nPL/5454/EXP/ES/2015\n...'}
            rows={4}
            className="admin-textarea"
          />

          <div className="admin-mass-controls">
            <div className="admin-mass-row">
              <div className="admin-mass-col">
                <label className="admin-label">Grupo</label>
                <select
                  value={bulkGrupo}
                  onChange={(e) => setBulkGrupo(e.target.value)}
                  className="admin-select admin-input-pill"
                >
                  <option value="">—</option>
                  {catalogGroups.map((g: any) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>

              <div className="admin-mass-col">
                <label className="admin-label">Usuario</label>
                <select
                  value={bulkEncargado}
                  onChange={(e) => setBulkEncargado(e.target.value)}
                  className="admin-select admin-input-pill"
                >
                  <option value="">—</option>
                  {catalogEncargados.map((enc: any) => (
                    <option key={enc.id} value={enc.nombre}>{enc.nombre}</option>
                  ))}
                </select>
              </div>

              <div className="admin-mass-col">
                <label className="admin-label">Sub</label>
                <select
                  value={bulkSubEncargado}
                  onChange={(e) => setBulkSubEncargado(e.target.value)}
                  className="admin-select admin-input-pill"
                >
                  <option value="">—</option>
                  {catalogSubEncargados.map((s: any) => (
                    <option key={s.id} value={s.nombre}>{s.nombre}</option>
                  ))}
                </select>
              </div>

              <div className="admin-mass-col">
                <label className="admin-label">Calibración</label>
                <select
                  value={bulkCalibracion}
                  onChange={(e) => setBulkCalibracion(e.target.value)}
                  className="admin-select admin-input-pill"
                >
                  <option value="">—</option>
                  <option value="S">Calibración solicitada (Cal-S)</option>
                  <option value="R">Calibración realizada (Cal-R)</option>
                </select>
              </div>

              <div className="admin-mass-col">
                <label className="admin-label">M13 (masivo)</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="home-config-btn"
                    style={BTN_BLACK}
                    disabled={bulkSaving}
                    onClick={() => openBulkM13('set')}
                  >
                    Aplicar M13
                  </button>
                  <button
                    type="button"
                    className="home-config-btn"
                    style={BTN_GRAY}
                    disabled={bulkSaving}
                    onClick={() => openBulkM13('unset')}
                  >
                    Quitar M13
                  </button>
                </div>
                <p className="admin-note" style={{ margin: 0 }}>
                  Solicita confirmación con contraseña y aplica a la lista cargada.
                </p>
              </div>
            </div>

            <div>
              <label className="admin-label">Comentario (opcional)</label>
              <input
                className="admin-input admin-input-rect"
                value={bulkComentario}
                onChange={(e) => setBulkComentario(e.target.value)}
                placeholder="Comentario para todos…"
              />
            </div>

            <div className="admin-mass-buttons" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="submit"
                disabled={bulkSaving}
                className="home-config-btn"
                style={BTN_BLACK}
              >
                {bulkSaving ? 'Buscando…' : 'Buscar lista'}
              </button>

              <button
                type="button"
                disabled={bulkSaving}
                className="home-config-btn"
                style={BTN_GRAY}
                onClick={onClickBulkApply}
              >
                {bulkSaving ? 'Aplicando…' : 'Aplicar a todos'}
              </button>

              <button
                type="button"
                disabled={bulkSaving}
                className="home-config-btn"
                style={BTN_DANGER}
                onClick={() => bulkSetBaja(true)}
                title="Dar de baja todos los códigos en la lista"
              >
                {bulkSaving ? 'Procesando…' : 'BAJA'}
              </button>

              <button
                type="button"
                disabled={bulkSaving}
                className="home-config-btn"
                style={BTN_GRAY}
                onClick={() => bulkSetBaja(false)}
                title="Quitar baja de todos los códigos en la lista"
              >
                {bulkSaving ? 'Procesando…' : 'Quitar BAJA'}
              </button>
            </div>

            {bulkError && <p className="admin-status admin-status-error">{bulkError}</p>}
            {bulkMessage && !bulkError && <p className="admin-status admin-status-ok">{bulkMessage}</p>}
            {bulkResults.length > 0 && (
              <p className="admin-status admin-status-muted">
                Se encontraron {bulkResults.length} códigos en la lista.
              </p>
            )}
          </div>
        </form>
      </section>

      {/* RESULTADOS */}
      <section>
        <header className="admin-list-header">
          <div>
            <h2 className="admin-list-title">Resultados</h2>
            <p className="admin-list-meta">
              {results.length === 0 ? 'Sin resultados' : `${results.length} resultados`}
            </p>
          </div>
        </header>

        <div className="admin-results">
          {results.map((item) => (
            <article key={item.id} className="admin-result-card" style={{ position: 'relative' }}>
              {/* ✅ BADGE BAJA (top right if active) */}
              {item.baja === true && (
                <div
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: item.calibracion ? 44 : 12,
                    fontSize: 11,
                    fontWeight: 800,
                    padding: '4px 10px',
                    borderRadius: 9999,
                    letterSpacing: '.04em',
                    background: '#dc2626',
                    color: '#fff',
                    border: '1px solid rgba(220,38,38,0.12)',
                  }}
                >
                  BAJA
                </div>
              )}

              {/* ✅ BADGE CAL (top right, clickable) */}
              {item.calibracion && (
                <button
                  type="button"
                  onClick={() => openDocumentos(item, 'cal')}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: 12,
                    fontSize: 11,
                    fontWeight: 800,
                    padding: '4px 10px',
                    borderRadius: 9999,
                    letterSpacing: '.04em',
                    background: item.calibracion === 'S' ? '#0ea5e9' : '#111827',
                    color: '#fff',
                    border: '1px solid rgba(17,24,39,0.12)',
                    cursor: 'pointer',
                  }}
                  title="Abrir documentos de calibración"
                >
                  {calLabel(item.calibracion)}
                </button>
              )}

              <div>
                <div className="admin-result-code">{item.code}</div>
                <div className="admin-result-id">ID: {item.id}</div>

                <div className="admin-field">
                  <label className="admin-label">Razón social</label>
                  <input
                    value={item.razon_social ?? ''}
                    onChange={(e) => updateLocalField(item.id, 'razon_social', e.target.value)}
                    className="admin-input admin-input-rect"
                  />
                </div>

                <div className="admin-field">
                  <label className="admin-label">Estado</label>
                  <input
                    value={item.estado ?? ''}
                    onChange={(e) => updateLocalField(item.id, 'estado', e.target.value)}
                    className="admin-input admin-input-rect"
                  />
                </div>

                <div className="admin-field">
                  <label className="admin-label">Municipio</label>
                  <input
                    value={item.municipio ?? ''}
                    onChange={(e) => updateLocalField(item.id, 'municipio', e.target.value)}
                    className="admin-input admin-input-rect"
                  />
                </div>

                <div className="admin-field">
                  <label className="admin-label">Dirección</label>
                  <input
                    value={item.direccion ?? ''}
                    onChange={(e) => updateLocalField(item.id, 'direccion', e.target.value)}
                    className="admin-input admin-input-rect"
                  />
                </div>

                <div className="admin-field">
                  <label className="admin-label">Comentario</label>
                  <input
                    value={item.comentario ?? ''}
                    onChange={(e) => updateLocalField(item.id, 'comentario', e.target.value)}
                    className="admin-input admin-input-rect"
                    placeholder="Comentario…"
                  />
                </div>
              </div>

              <div>
                <div className="admin-field">
                  <label className="admin-label">Grupo</label>
                  <select
                    value={item.grupo_id ?? ''}
                    onChange={(e) => updateLocalField(item.id, 'grupo_id', e.target.value ? Number(e.target.value) : null)}
                    className="admin-select admin-input-pill"
                  >
                    <option value="">—</option>
                    {catalogGroups.map((g: any) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>

                <div className="admin-field">
                  <label className="admin-label">Usuario</label>
                  <select
                    value={item.encargado_actual ?? ''}
                    onChange={(e) => updateLocalField(item.id, 'encargado_actual', e.target.value)}
                    className="admin-select admin-input-pill admin-select-wide"
                  >
                    <option value="">—</option>
                    {catalogEncargados.map((enc: any) => (
                      <option key={enc.id} value={enc.nombre}>{enc.nombre}</option>
                    ))}
                  </select>
                </div>

                <div className="admin-field">
                  <label className="admin-label">Sub</label>
                  <select
                    value={item.encargado_anterior ?? ''}
                    onChange={(e) => updateLocalField(item.id, 'encargado_anterior', e.target.value)}
                    className="admin-select admin-input-pill admin-select-wide"
                  >
                    <option value="">—</option>
                    {catalogSubEncargados.map((s: any) => (
                      <option key={s.id} value={s.nombre}>{s.nombre}</option>
                    ))}
                  </select>
                </div>

                <div className="admin-field">
                  <label className="admin-label">Calibración</label>
                  <select
                    value={item.calibracion ?? ''}
                    onChange={(e) => updateLocalField(item.id, 'calibracion', e.target.value || null)}
                    className="admin-select admin-input-pill admin-select-wide"
                  >
                    <option value="">—</option>
                    <option value="S">Calibración solicitada (Cal-S)</option>
                    <option value="R">Calibración realizada (Cal-R)</option>
                  </select>
                </div>

                <div className="admin-field">
                  <label className="admin-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={item.m13 === true}
                      onChange={(e) => openM13ModalForItem(item, e.target.checked)}
                    />
                    M13
                  </label>
                </div>

                <div className="admin-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="home-config-btn"
                    style={BTN_GRAY}
                    onClick={() => openVisitas(item)}
                    title="Ver visitas"
                  >
                    Visitas
                  </button>

                    <button
                    type="button"
                    className="home-config-btn"
                    style={BTN_GRAY}
                    onClick={() => openDocumentos(item, 'general')}
                    title="Ver documentos"
                  >
                    Documentos
                  </button>

                  {item.baja === true ? (
                    <button
                      type="button"
                      disabled={bajaActionId === item.id}
                      className="home-config-btn"
                      style={BTN_GRAY}
                      onClick={() => toggleBaja(item, false)}
                      title="Quitar baja"
                    >
                      {bajaActionId === item.id ? 'Quitando…' : 'Quitar baja'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={bajaActionId === item.id}
                      className="home-config-btn"
                      style={BTN_DANGER}
                      onClick={() => toggleBaja(item, true)}
                      title="Dar de baja"
                    >
                      {bajaActionId === item.id ? 'Dando baja…' : 'Dar de baja'}
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={savingId === item.id}
                    className="home-config-btn"
                    style={savingId === item.id ? BTN_GRAY : BTN_BLACK}
                    onClick={() => saveItem(item)}
                  >
                    {savingId === item.id ? 'Guardando…' : 'Guardar cambios'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* MODAL VISITAS */}
      {visitsModal.open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 100000,
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
              maxWidth: 720,
              background: '#fff',
              borderRadius: 18,
              border: '1px solid #e5e7eb',
              boxShadow: '0 18px 60px rgba(0,0,0,0.25)',
              overflow: 'hidden',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
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
                <div className="admin-tag">Visitas</div>
                <div style={{ fontSize: 14, fontWeight: 900, marginTop: 2 }}>
                  Código {visitsModal.code || visitsModal.codeId}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  Lista, agrega y administra visitas del código.
                </div>
              </div>

              <button type="button" className="home-config-btn" style={BTN_BLACK} onClick={closeVisitsModal}>
                Cerrar
              </button>
            </div>

            <div style={{ padding: 16, overflowY: 'auto' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
                <div>
                  <label className="admin-label">Fecha (YYYY-MM-DD)</label>
                  <input
                    type="date"
                    className="admin-input admin-input-pill"
                    value={visitsModal.addDate}
                    onChange={(e) => setVisitsModal((prev) => ({ ...prev, addDate: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="admin-label">Tipo</label>
                  <select
                    className="admin-select admin-input-pill"
                    value={visitsModal.addType}
                    onChange={(e) =>
                      setVisitsModal((prev) => ({
                        ...prev,
                        addType: (e.target.value as VisitType) || 'verificacion',
                      }))
                    }
                  >
                    <option value="verificacion">Verificación</option>
                    <option value="calibracion">Calibración</option>
                    <option value="supervision">Supervisión</option>
                    <option value="cateo">Cateo</option>
                  </select>
                </div>

                <div style={{ flex: '1 1 220px', minWidth: 200 }}>
                  <label className="admin-label">Notas (opcional)</label>
                  <input
                    className="admin-input admin-input-pill"
                    value={visitsModal.addNotes}
                    onChange={(e) => setVisitsModal((prev) => ({ ...prev, addNotes: e.target.value }))}
                    placeholder="Notas…"
                  />
                </div>

                <button
                  type="button"
                  className="home-config-btn"
                  style={BTN_BLACK}
                  disabled={visitsModal.addSaving}
                  onClick={addVisit}
                >
                  {visitsModal.addSaving ? 'Guardando…' : 'Agregar visita'}
                </button>
              </div>

              {visitsModal.error && (
                <p className="admin-status admin-status-error" style={{ marginTop: 10 }}>
                  {visitsModal.error}
                </p>
              )}
              {visitsModal.success && !visitsModal.error && (
                <p className="admin-status admin-status-ok" style={{ marginTop: 10 }}>
                  {visitsModal.success}
                </p>
              )}

              {visitsModal.loading ? (
                <p className="admin-status admin-status-muted" style={{ marginTop: 12 }}>
                  Cargando visitas…
                </p>
              ) : visitsModal.list.length === 0 ? (
                <p className="admin-status admin-status-muted" style={{ marginTop: 12 }}>
                  Sin visitas registradas.
                </p>
              ) : (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {visitsModal.list.map((v) => (
                    <div
                      key={v.id}
                      style={{
                        border: '1px solid #e5e7eb',
                        borderRadius: 12,
                        padding: 12,
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{v.visit_date}</div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{v.visit_type}</div>
                        {v.notes && (
                          <div style={{ fontSize: 12, color: '#111827', marginTop: 6, maxWidth: 360 }}>
                            {v.notes}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="home-config-btn"
                          style={BTN_GRAY}
                          onClick={() => openVisitFiles(v)}
                        >
                          Archivos
                        </button>

                        {isAdmin && (
                          <button
                            type="button"
                            className="home-config-btn"
                            style={BTN_DANGER}
                            disabled={visitsModal.deletingId === v.id}
                            onClick={() => deleteVisit(v.id)}
                          >
                            {visitsModal.deletingId === v.id ? 'Eliminando…' : 'Eliminar'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL ARCHIVOS DE VISITA */}
      {visitFilesModal.open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 100001,
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
              maxWidth: 720,
              background: '#fff',
              borderRadius: 18,
              border: '1px solid #e5e7eb',
              boxShadow: '0 18px 60px rgba(0,0,0,0.25)',
              overflow: 'hidden',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
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
                <div className="admin-tag">Archivos de visita</div>
                <div style={{ fontSize: 14, fontWeight: 900, marginTop: 2 }}>
                  {visitFilesModal.visitLabel || 'Visita'}
                </div>
              </div>

              <button type="button" className="home-config-btn" style={BTN_BLACK} onClick={closeVisitFilesModal}>
                Cerrar
              </button>
            </div>

            <div style={{ padding: 16, overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <input
                  type="file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadVisitFile(file);
                    e.target.value = '';
                  }}
                  disabled={visitFilesModal.uploading}
                />
                {visitFilesModal.uploading && (
                  <span className="admin-status admin-status-muted">Subiendo…</span>
                )}
              </div>

              {visitFilesModal.error && (
                <p className="admin-status admin-status-error" style={{ marginTop: 10 }}>
                  {visitFilesModal.error}
                </p>
              )}

              {visitFilesModal.loading ? (
                <p className="admin-status admin-status-muted" style={{ marginTop: 12 }}>
                  Cargando archivos…
                </p>
              ) : visitFilesModal.list.length === 0 ? (
                <p className="admin-status admin-status-muted" style={{ marginTop: 12 }}>
                  Sin archivos.
                </p>
              ) : (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {visitFilesModal.list.map((f) => (
                    <div
                      key={f.id}
                      style={{
                        border: '1px solid #e5e7eb',
                        borderRadius: 12,
                        padding: 12,
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{f.file_name}</div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                          {f.content_type || '—'} · {formatBytes(f.size)}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="home-config-btn"
                          style={BTN_GRAY}
                          disabled={visitFilesModal.downloadingId === f.id}
                          onClick={() => downloadVisitFile(f)}
                        >
                          {visitFilesModal.downloadingId === f.id ? 'Descargando…' : 'Descargar'}
                        </button>

                        {isAdmin && (
                          <button
                            type="button"
                            className="home-config-btn"
                            style={BTN_DANGER}
                            disabled={visitFilesModal.deletingId === f.id}
                            onClick={() => deleteVisitFile(f.id)}
                          >
                            {visitFilesModal.deletingId === f.id ? 'Eliminando…' : 'Eliminar'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL DOCUMENTOS */}
      {docsModal.open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 100002,
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
              maxWidth: 720,
              background: '#fff',
              borderRadius: 18,
              border: '1px solid #e5e7eb',
              boxShadow: '0 18px 60px rgba(0,0,0,0.25)',
              overflow: 'hidden',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
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
                <div className="admin-tag">Documentos ({docsModal.kind === 'cal' ? 'Calibración' : 'General'})</div>
                <div style={{ fontSize: 14, fontWeight: 900, marginTop: 2 }}>
                  Código {docsModal.code || docsModal.codeId}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  Gestiona documentos del código.
                </div>
              </div>

              <button type="button" className="home-config-btn" style={BTN_BLACK} onClick={closeDocsModal}>
                Cerrar
              </button>
            </div>

            <div style={{ padding: 16, overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <input
                  type="file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadDoc(file);
                    e.target.value = '';
                  }}
                  disabled={docsModal.uploading}
                />
                {docsModal.uploading && (
                  <span className="admin-status admin-status-muted">Subiendo…</span>
                )}
              </div>

              {docsModal.error && (
                <p className="admin-status admin-status-error" style={{ marginTop: 10 }}>
                  {docsModal.error}
                </p>
              )}

              {docsModal.loading ? (
                <p className="admin-status admin-status-muted" style={{ marginTop: 12 }}>
                  Cargando documentos…
                </p>
              ) : docsModal.list.length === 0 ? (
                <p className="admin-status admin-status-muted" style={{ marginTop: 12 }}>
                  Sin documentos.
                </p>
              ) : (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {docsModal.list.map((d) => (
                    <div
                      key={d.id}
                      style={{
                        border: '1px solid #e5e7eb',
                        borderRadius: 12,
                        padding: 12,
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{d.file_name}</div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                          {d.content_type || '—'} · {formatBytes(d.size)}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="home-config-btn"
                          style={BTN_GRAY}
                          disabled={docsModal.downloadingId === d.id}
                          onClick={() => downloadDoc(d)}
                        >
                          {docsModal.downloadingId === d.id ? 'Descargando…' : 'Descargar'}
                        </button>

                        {isAdmin && (
                          <button
                            type="button"
                            className="home-config-btn"
                            style={BTN_DANGER}
                            disabled={docsModal.deletingId === d.id}
                            onClick={() => deleteDoc(d.id)}
                          >
                            {docsModal.deletingId === d.id ? 'Eliminando…' : 'Eliminar'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
