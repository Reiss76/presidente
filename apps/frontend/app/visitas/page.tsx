'use client';

import React, { useEffect, useMemo, useState } from 'react';
import AppHeader from '../../components/AppHeader';
import { getApiBase } from '../../lib/api';

const API = getApiBase();

type VisitType = 'verificacion' | 'calibracion' | 'supervision' | 'cateo';

type VisitRow = {
  visit_id: number;
  code_id: number;
  code: string;
  visit_date: string; // YYYY-MM-DD
  visit_type: VisitType;
  notes?: string | null;
  created_at?: string | null;

  grupo_id?: number | null;
  usuario?: string | null;
  sub?: string | null;
  baja?: boolean | null;
  razon_social?: string | null;
  m13?: boolean | null;
};

type VisitFileItem = {
  id: number;
  code_id: number;
  visit_id: number;
  fileName: string;
  contentType: string | null;
  size: number | null;
  storageKey?: string;
  createdAt: string | Date;
};

function labelVisitType(t: VisitType) {
  if (t === 'verificacion') return 'Verificación';
  if (t === 'calibracion') return 'Calibración';
  if (t === 'cateo') return 'Cateo';
  return 'Supervisión';
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

async function safeJson(res: Response) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return { message: await res.text() };
}

export default function VisitasPage() {
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  
  const [catalogGroups, setCatalogGroups] = useState<{ id: number; name: string }[]>([]);
  const [catalogUsers, setCatalogUsers] = useState<{ id: number; nombre: string }[]>([]);

  // filtros
  const [preset, setPreset] = useState<'1d' | '7d' | '15d' | '30d' | ''>('7d');
  const [month, setMonth] = useState(''); // YYYY-MM
  const [from, setFrom] = useState(''); // YYYY-MM-DD
  const [to, setTo] = useState(''); // YYYY-MM-DD
  const [visitType, setVisitType] = useState<VisitType | ''>('');
  const [usuario, setUsuario] = useState('');
  const [grupoId, setGrupoId] = useState('');
  const [includeBaja, setIncludeBaja] = useState(false);

  // results
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [items, setItems] = useState<VisitRow[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // =========================
  // MODAL ARCHIVOS POR VISITA
  // =========================
  const [filesOpenFor, setFilesOpenFor] = useState<VisitRow | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [filesItems, setFilesItems] = useState<VisitFileItem[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    try {
      const raw = window.localStorage.getItem('cosmosx_user');
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.username) setUser(parsed);
      else setUser(null);
    } catch {
      setUser(null);
    }
  }, [mounted]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/codes/tools/catalogs`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        setCatalogGroups(Array.isArray(data?.groups) ? data.groups : []);
        setCatalogUsers(Array.isArray(data?.encargados) ? data.encargados : []);
      } catch {}
    })();
  }, []);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (preset) p.set('preset', preset);
    if (month) p.set('month', month);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (visitType) p.set('visit_type', visitType);
    if (usuario) p.set('usuario', usuario);
    if (grupoId) p.set('grupo_id', grupoId);
    if (includeBaja) p.set('include_baja', 'true');
    p.set('limit', '500');
    return p.toString();
  }, [preset, month, from, to, visitType, usuario, grupoId, includeBaja]);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      const res = await fetch(`${API}/visits?${qs}`, {
        credentials: 'include',
        cache: 'no-store',
      });

      const data = await safeJson(res);
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);

      const list: VisitRow[] = Array.isArray((data as any)?.items) ? (data as any).items : [];
      setItems(list);
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar visitas.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  async function deleteVisit(v: VisitRow) {
    if (!user || user.role !== 'admin') return;
    const confirm = typeof window !== 'undefined'
      ? window.confirm('¿Seguro que deseas eliminar esta visita? Esta acción no se puede deshacer.')
      : false;
    if (!confirm) return;

    try {
      setDeletingId(v.visit_id);
      setError(null);
      setSuccess(null);
      const res = await fetch(`${API}/codes/${v.code_id}/visits/${v.visit_id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await safeJson(res);
      if (res.status === 401 || res.status === 403) throw new Error('Sesión expirada, vuelve a login');
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);
      setSuccess('✅ Visita eliminada');
      await load();
    } catch (e: any) {
      setError(e?.message || 'No se pudo eliminar la visita');
    } finally {
      setDeletingId(null);
    }
  }

  // UX: si eliges month o rango, apagamos preset
  function setPresetSafe(v: typeof preset) {
    setPreset(v);
    if (v) {
      setMonth('');
      setFrom('');
      setTo('');
    }
  }
  function setMonthSafe(v: string) {
    setMonth(v);
    if (v) {
      setPreset('');
      setFrom('');
      setTo('');
    }
  }
  function setRangeSafe(nf: string, nt: string) {
    setFrom(nf);
    setTo(nt);
    if (nf || nt) {
      setPreset('');
      setMonth('');
    }
  }

  // ============
  // VISIT FILES
  // ============
  async function loadVisitFiles(v: VisitRow) {
    setFilesOpenFor(v);
    setUploadFile(null);
    setFilesLoading(true);
    setFilesError(null);
    setFilesItems([]);

    try {
      const res = await fetch(`${API}/codes/${v.code_id}/visits/${v.visit_id}/files`, {
        credentials: 'include',
        cache: 'no-store',
      });

      const data = await safeJson(res);
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);

      // backend puede devolver {ok:true, items:[...]} o directo [...]
      const list: any[] = Array.isArray(data) ? data : Array.isArray((data as any).items) ? (data as any).items : [];

      setFilesItems(
        list.map((x) => ({
          id: Number(x.id),
          code_id: Number(x.code_id ?? v.code_id),
          visit_id: Number(x.visit_id ?? v.visit_id),
          fileName: String(x.fileName ?? x.file_name ?? 'archivo'),
          contentType: x.contentType ?? x.content_type ?? null,
          size: x.size != null ? Number(x.size) : null,
          storageKey: x.storageKey ?? x.storage_key,
          createdAt: x.createdAt ?? x.created_at ?? '',
        })),
      );
    } catch (e: any) {
      setFilesError(e?.message || 'No se pudieron cargar los archivos de esta visita.');
      setFilesItems([]);
    } finally {
      setFilesLoading(false);
    }
  }

  function closeVisitFilesModal() {
    setFilesOpenFor(null);
    setFilesError(null);
    setFilesItems([]);
    setFilesLoading(false);
    setUploadFile(null);
    setUploading(false);
  }

  async function uploadVisitFile() {
    if (!filesOpenFor || !uploadFile) return;

    let createdFileId: number | null = null;

    try {
      setUploading(true);
      setFilesError(null);

      // 1) presign
      const presignRes = await fetch(
        `${API}/codes/${filesOpenFor.code_id}/visits/${filesOpenFor.visit_id}/files/presign`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            fileName: uploadFile.name,
            contentType: uploadFile.type || 'application/octet-stream',
            size: uploadFile.size,
          }),
        },
      );

      const presign = await safeJson(presignRes);
      if (!presignRes.ok || !(presign as any)?.uploadUrl) {
        throw new Error((presign as any)?.message || `Error ${presignRes.status}`);
      }

      createdFileId = Number((presign as any)?.fileId ?? 0) || null;

      // 2) PUT directo a R2 (SIN headers, iOS-friendly)
      const putRes = await fetch((presign as any).uploadUrl, {
        method: 'PUT',
        body: uploadFile,
      });

      // Si falla el PUT, borramos el registro para no dejar fantasma
      if (!putRes.ok) {
        if (createdFileId) {
          await fetch(
            `${API}/codes/${filesOpenFor.code_id}/visits/${filesOpenFor.visit_id}/files/${createdFileId}`,
            { method: 'DELETE', credentials: 'include' },
          ).catch(() => {});
        }
        throw new Error(`Falló la subida (HTTP ${putRes.status})`);
      }

      setUploadFile(null);

      // 3) refresca lista
      await loadVisitFiles(filesOpenFor);
    } catch (e: any) {
      setFilesError(e?.message || 'Error subiendo el archivo.');
    } finally {
      setUploading(false);
    }
  }

  async function deleteVisitFile(fileId: number) {
    if (!filesOpenFor) return;

    try {
      setFilesLoading(true);
      setFilesError(null);

      const res = await fetch(
        `${API}/codes/${filesOpenFor.code_id}/visits/${filesOpenFor.visit_id}/files/${fileId}`,
        { method: 'DELETE', credentials: 'include' },
      );

      const data = await safeJson(res);
      if (!res.ok) throw new Error((data as any)?.message || `Error ${res.status}`);

      await loadVisitFiles(filesOpenFor);
    } catch (e: any) {
      setFilesError(e?.message || 'Error borrando archivo.');
    } finally {
      setFilesLoading(false);
    }
  }

  async function downloadVisitFile(fileId: number, fileName?: string) {
    if (!filesOpenFor) return;

    try {
      setFilesError(null);

      const url = `${API.replace(/\/+$/, '')}/codes/${filesOpenFor.code_id}/visits/${filesOpenFor.visit_id}/files/${fileId}/download`;

      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });

      const ct = res.headers.get('content-type') || '';
      if (!res.ok) {
        const txt = ct.includes('application/json') ? JSON.stringify(await res.json()) : await res.text().catch(() => '');
        throw new Error(txt || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = fileName || `archivo-${fileId}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e: any) {
      setFilesError(`Error al descargar: ${e?.message || String(e)}`);
    }
  }

  return (
    <main className="admin-layout">
      <div className="admin-inner">
        {/* ========= MODAL ARCHIVOS POR VISITA ========= */}
        {filesOpenFor && (
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
                maxWidth: 880,
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
                    Archivos de visita
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    <strong>{filesOpenFor.code}</strong> · {filesOpenFor.visit_date} · {labelVisitType(filesOpenFor.visit_type)}
                    {filesOpenFor.m13 ? ' · M13' : ''}
                  </div>
                </div>

                <button
                  className="admin-btn"
                  type="button"
                  style={{ background: '#111827', color: '#fff' }}
                  onClick={closeVisitFilesModal}
                >
                  Cerrar
                </button>
              </div>

              <div style={{ padding: 16, maxHeight: '70vh', overflow: 'auto' }}>
                {/* Subir */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="file"
                    className="admin-input admin-input-pill"
                    onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  />
                  <button
                    className="admin-btn"
                    type="button"
                    style={{ background: '#111827', color: '#fff' }}
                    disabled={!uploadFile || uploading}
                    onClick={uploadVisitFile}
                  >
                    {uploading ? 'Subiendo…' : 'Subir archivo'}
                  </button>
                </div>

                {filesLoading && <p className="admin-status admin-status-muted" style={{ marginTop: 10 }}>Cargando…</p>}
                {filesError && <p className="admin-status admin-status-error" style={{ marginTop: 10 }}>{filesError}</p>}

                {!filesLoading && !filesError && filesItems.length === 0 && (
                  <p className="admin-status admin-status-muted" style={{ marginTop: 10 }}>
                    No hay archivos para esta visita.
                  </p>
                )}

                {!filesLoading && filesItems.length > 0 && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {filesItems.map((f) => (
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
                        <div style={{ minWidth: 260 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: '#111827' }}>{f.fileName}</div>
                          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                            {formatBytes(f.size)} {f.contentType ? ` · ${f.contentType}` : ''}
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="home-config-btn"
                            onClick={() => downloadVisitFile(f.id, f.fileName)}
                          >
                            Descargar
                          </button>

                          <button
                            type="button"
                            className="home-config-btn"
                            style={{ background: '#fee2e2' }}
                            onClick={() => deleteVisitFile(f.id)}
                          >
                            Borrar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ padding: 12, borderTop: '1px solid #e5e7eb' }}>
                <p className="admin-subtitle" style={{ margin: 0 }}>
                  Tip: estos archivos son <strong>por visita</strong> (no se mezclan con documentos generales/calibración del código).
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ========= HEADER ========= */}
<AppHeader
  title="COSMOSX"
  subtitle="Visitas"
  user={user}
  showAsignaciones={true}
  showAdmin={true}
  showVisitas={true}
  showDashboard={user?.role === 'admin'}
/>
        <section className="admin-card">
          <div className="admin-label">Periodo</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button
              type="button"
              className="home-config-btn"
              style={{ background: preset === '1d' ? '#111827' : undefined, color: preset === '1d' ? '#fff' : undefined }}
              onClick={() => setPresetSafe('1d')}
            >
              Último día
            </button>
            <button
              type="button"
              className="home-config-btn"
              style={{ background: preset === '7d' ? '#111827' : undefined, color: preset === '7d' ? '#fff' : undefined }}
              onClick={() => setPresetSafe('7d')}
            >
              7 días
            </button>
            <button
              type="button"
              className="home-config-btn"
              style={{ background: preset === '15d' ? '#111827' : undefined, color: preset === '15d' ? '#fff' : undefined }}
              onClick={() => setPresetSafe('15d')}
            >
              15 días
            </button>
            <button
              type="button"
              className="home-config-btn"
              style={{ background: preset === '30d' ? '#111827' : undefined, color: preset === '30d' ? '#fff' : undefined }}
              onClick={() => setPresetSafe('30d')}
            >
              30 días
            </button>
          </div>

          <div style={{ height: 1, background: '#e5e7eb', margin: '12px 0' }} />

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
            <div>
              <label className="admin-label">Mes</label>
              <input type="month" className="admin-input admin-input-pill" value={month} onChange={(e) => setMonthSafe(e.target.value)} />
            </div>

            <div>
              <label className="admin-label">Desde</label>
              <input type="date" className="admin-input admin-input-pill" value={from} onChange={(e) => setRangeSafe(e.target.value, to)} />
            </div>

            <div>
              <label className="admin-label">Hasta</label>
              <input type="date" className="admin-input admin-input-pill" value={to} onChange={(e) => setRangeSafe(from, e.target.value)} />
            </div>

            <div>
              <label className="admin-label">Tipo</label>
              <select className="admin-select admin-input-pill" value={visitType} onChange={(e) => setVisitType(e.target.value as any)}>
                <option value="">—</option>
                <option value="verificacion">Verificación</option>
                <option value="calibracion">Calibración</option>
                <option value="supervision">Supervisión</option>
                <option value="cateo">Cateo</option>
              </select>
            </div>

            <div>
              <label className="admin-label">Usuario</label>
              <select className="admin-select admin-input-pill" value={usuario} onChange={(e) => setUsuario(e.target.value)}>
                <option value="">—</option>
                {catalogUsers.map((u) => (
                  <option key={u.id} value={u.nombre}>{u.nombre}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="admin-label">Grupo</label>
              <select className="admin-select admin-input-pill" value={grupoId} onChange={(e) => setGrupoId(e.target.value)}>
                <option value="">—</option>
                {catalogGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>

            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#374151' }}>
              <input type="checkbox" checked={includeBaja} onChange={(e) => setIncludeBaja(e.target.checked)} />
              Incluir BAJA
            </label>

            <button className="admin-btn" style={{ background: '#111827', color: '#fff' }} type="button" onClick={load}>
              Refrescar
            </button>
          </div>
        </section>

        <section className="admin-card">
          <div className="admin-label">Lista</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            {loading ? 'Cargando…' : `${items.length} visita(s)`}
          </div>

          {success && <p className="admin-status" style={{ marginTop: 10, color: '#059669' }}>{success}</p>}
          {error && <p className="admin-status admin-status-error" style={{ marginTop: 10 }}>{error}</p>}
          {!loading && !error && items.length === 0 && (
            <p className="admin-status admin-status-muted" style={{ marginTop: 10 }}>
              No hay visitas para esos filtros.
            </p>
          )}

          {!loading && items.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.map((v) => (
                <div
                  key={v.visit_id}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 14,
                    padding: 12,
                    background: '#f9fafb',
                    display: 'flex',
                    gap: 12,
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ minWidth: 240 }}>
                    <div style={{ fontWeight: 900, color: '#111827' }}>{v.code}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      {v.visit_date} · {labelVisitType(v.visit_type)}
                      {v.baja ? ' · BAJA' : ''}
                      {v.m13 ? ' · M13' : ''}
                    </div>
                    {v.razon_social && (
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        {v.razon_social}
                      </div>
                    )}
                    {v.notes && (
                      <div style={{ fontSize: 12, color: '#374151', marginTop: 6 }}>
                        Nota: {v.notes}
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: 12, color: '#374151' }}>
                    Usuario: <strong>{v.usuario?.trim() ? v.usuario : 'SIN ASIGNAR'}</strong>
                  </div>

                  <div style={{ fontSize: 12, color: '#374151' }}>
                    Grupo: <strong>{v.grupo_id ?? '—'}</strong>
                  </div>

                  <div style={{ fontSize: 12, color: '#374151' }}>
                    Sub: <strong>{v.sub?.trim() ? v.sub : '—'}</strong>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="home-config-btn"
                      onClick={() => loadVisitFiles(v)}
                      title="Archivos de esta visita"
                    >
                      Archivos
                    </button>

                    {user?.role === 'admin' && (
                      <button
                        type="button"
                        className="home-config-btn"
                        style={{ background: '#fee2e2' }}
                        disabled={deletingId === v.visit_id}
                        onClick={() => deleteVisit(v)}
                      >
                        {deletingId === v.visit_id ? 'Borrando…' : 'Eliminar'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
