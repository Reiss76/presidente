'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../../lib/api';

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

  //  Calibración
  // "S" = Solicitada (Cal-S)
  // "R" = Realizada (Cal-R)
  calibracion?: string | null;
};

type AuthUser = {
  id: number;
  username: string;
  role: string; // 'admin' | 'editor' (pero llega como string)
};

type AdminPanelProps = {
  currentUser: AuthUser;
};

type ColabRole = 'admin' | 'editor';

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

export default function AdminPanel({ currentUser }: AdminPanelProps) {
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

  // ✅ NUEVO: confirmación para “cambiar usuario” masivamente
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

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
        const res = await fetch(`${API}/codes/by-code?code=${encodeURIComponent(trimmed)}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data = await res.json();
        if (data) items = [data as CodeItem];
      } else {
        const res = await fetch(`${API}/codes?query=${encodeURIComponent(trimmed)}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data = await res.json();
        items = (Array.isArray(data) ? data : (data as any).items || []) as CodeItem[];
      }

      setResults(items);
      if (!items.length) setError(`No se encontraron resultados para "${trimmed}".`);
    } catch (err) {
      console.error(err);
      setError('Ocurrió un error al buscar. Intenta de nuevo.');
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
  // BÚSQUEDA MASIVA (CÓDIGOS)
  // -----------------------
  async function bulkLookup(e: React.FormEvent) {
    e.preventDefault();
    const lines = bulkInput
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (!lines.length) {
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
        body: JSON.stringify({ codes: lines }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);

      const arr = Array.isArray(data) ? (data as CodeItem[]) : ((data as any).items as CodeItem[]) || [];
      setBulkResults(arr);
      setResults(arr);

      if (!arr.length) setBulkError('Ninguno de los códigos pegados fue encontrado.');
    } catch (err) {
      console.error(err);
      setBulkError('Error al buscar la lista. Intenta de nuevo.');
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

    return body;
  }, [bulkResults, bulkGrupo, bulkEncargado, bulkSubEncargado, bulkComentario, bulkCalibracion]);

  function openConfirmIfNeeded(): boolean {
    // Solo se dispara si vas a cambiar USUARIO masivamente.
    if (!bulkEncargado) return false;

    // Si la lista contiene códigos con usuario asignado distinto al nuevo, pedimos confirmación.
    const target = bulkEncargado.trim();
    const hasConflicts = bulkResults.some((r) => {
      const cur = (r.encargado_actual ?? '').trim();
      return cur.length > 0 && cur !== target;
    });

    if (!hasConflicts) return false;

    // Abre modal
    setConfirmPassword('');
    setConfirmError(null);
    setConfirmOpen(true);
    return true;
  }

  async function bulkApply(forceUserChange: boolean, authPassword?: string) {
    if (!bulkResults.length) {
      setBulkError('Primero busca la lista.');
      return;
    }

    if (!bulkGrupo && !bulkEncargado && !bulkSubEncargado && !bulkComentario.trim() && !bulkCalibracion) {
      setBulkError('Ingresa Grupo, Usuario, Sub, Comentario o Calibración.');
      return;
    }

    try {
      setBulkSaving(true);
      setBulkError(null);
      setBulkMessage(null);

      const finalBody: any = { ...bulkBody };

      // ✅ Override controlado (solo cuando confirmas)
      if (forceUserChange) {
        finalBody.force_user_change = true;
        finalBody.auth_password = authPassword || '';
      }

      const res = await fetch(`${API}/codes/bulk-update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(finalBody),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.message || 'Error al aplicar cambios');

      const updated: CodeItem[] = (data as any).updated || [];
      const skipped = (data as any).skipped || [];

      const updatedMap = new Map(updated.map((u: CodeItem) => [u.id, u]));

      setResults((prev) => prev.map((p) => updatedMap.get(p.id) ?? p));
      setBulkResults(updated);

      if (updated.length) setBulkMessage(`Cambios aplicados a ${updated.length} código(s).`);
      else setBulkMessage(null);

      // Si NO forzaste, backend puede “skipppear” por usuario existente.
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
      }
    } catch (err: any) {
      console.error(err);
      setBulkError(err?.message || 'No se pudieron aplicar cambios.');
    } finally {
      setBulkSaving(false);
    }
  }

  async function onClickBulkApply() {
    // 1) Si detecta cambio de usuario con conflictos -> modal
    if (openConfirmIfNeeded()) return;

    // 2) Si no hay conflicto o no hay usuario -> apply normal
    await bulkApply(false);
  }

  async function confirmOverride() {
    const pw = confirmPassword.trim();
    if (!pw) {
      setConfirmError('Escribe tu contraseña para confirmar.');
      return;
    }

    try {
      setConfirmLoading(true);
      setConfirmError(null);

      await bulkApply(true, pw);

      // si bulkApply puso error, no cerramos a la fuerza; pero normalmente cerramos
      setConfirmOpen(false);
      setConfirmPassword('');
    } catch (e: any) {
      setConfirmError(e?.message || 'No se pudo confirmar.');
    } finally {
      setConfirmLoading(false);
    }
  }

  function cancelOverride() {
    setConfirmOpen(false);
    setConfirmPassword('');
    setConfirmError(null);
  }

  // -----------------------
  // CARGAR CATÁLOGOS
  // -----------------------
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API}/codes/tools/catalogs`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setCatalogGroups((data as any).groups || []);
          setCatalogEncargados((data as any).encargados || []);
          setCatalogSubEncargados((data as any).subEncargados || []);
        }
      } catch (err) {
        console.error(err);
      }
    }
    load();
  }, []);

  // -----------------------
  // UI
  // -----------------------
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
              {/* ✅ BADGE CAL (mantiene color) */}
              {item.calibracion && (
                <div
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: 12,
                    fontSize: 11,
                    fontWeight: 800,
                    padding: '4px 10px',
                    borderRadius: 9999,
                    letterSpacing: '.04em',
                    background: item.calibracion === 'S' ? '#0ea5e9' : '#111827',
                    color: '#fff',
                    border: '1px solid rgba(17,24,39,0.12)',
                  }}
                >
                  {calLabel(item.calibracion)}
                </div>
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

                <div className="admin-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
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
    </>
  );
}
