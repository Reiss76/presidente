'use client';

import React, { useEffect, useState } from 'react';
import AppHeader from '../../components/AppHeader';
import { getApiBase, fetchJson } from '../../lib/api';

type AuthUser = {
  id: number;
  username: string;
  role: string;
};

type CodeItem = {
  id: number;
  code: string;
  razon_social?: string | null;
  estado?: string | null;
  municipio?: string | null;
  direccion?: string | null;
  grupo_id?: number | null;
  encargado_actual?: string | null;
  encargado_anterior?: string | null;
  baja?: boolean | null;
  m13?: boolean | null;
};

type CatalogsResponse = {
  ok?: boolean;
  error?: string;
  encargados?: (string | { nombre: string })[];
  subEncargados?: (string | { nombre: string })[];
  users?: string[];
  subs?: string[];
};

const API = getApiBase();

function extractPureCode(input: string): string {
  if (!input) return '';
  const clean = input.toUpperCase().replace(/\s+/g, '');
  const m = clean.match(/PL\/(\d+)\//);
  if (m?.[1]) return m[1];
  if (/^\d+$/.test(clean)) return clean;
  const d = clean.match(/\d+/);
  return d ? d[0] : '';
}

function normalizeList(text: string): string[] {
  return text
    .split('\n')
    .map((l) => String(l ?? '').trim())
    .filter(Boolean)
    .map(extractPureCode)
    .filter(Boolean);
}

function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ===== CSV resultados (panel principal) ===== */
function toCSVResultados(items: CodeItem[]) {
  const headers = [
    'id',
    'core',
    'code',
    'razon_social',
    'estado',
    'municipio',
    'direccion',
    'grupo_id',
    'encargado_actual',
    'baja',
  ];
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = items.map((it) => {
    const core = extractPureCode(it.code);
    return [
      it.id,
      core,
      it.code,
      it.razon_social,
      it.estado,
      it.municipio,
      it.direccion,
      it.grupo_id,
      it.encargado_actual,
      it.baja ? 'BAJA' : '',
    ]
      .map(esc)
      .join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}

/* ===== CSV libres (panel comparación) ===== */
type LibreRow = { core: string; status: 'SIN_ASIGNAR' | 'NO_ENCONTRADO' };

function toCSVLibres(rows: LibreRow[]) {
  const headers = ['core', 'status'];
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [r.core, r.status].map(esc).join(','));
  return [headers.join(','), ...lines].join('\n');
}

export default function AsignacionesPage() {
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  // catálogos
  const [usuarios, setUsuarios] = useState<string[]>([]);
  const [subUsuarios, setSubUsuarios] = useState<string[]>([]);
  const [estados, setEstados] = useState<string[]>([]);
  const [municipios, setMunicipios] = useState<string[]>([]);

  // filtros
  const [usuario, setUsuario] = useState('');
  const [subUsuario, setSubUsuario] = useState('');
  const [estado, setEstado] = useState('');
  const [municipio, setMunicipio] = useState('');
  const [m13, setM13] = useState('');

  // error catálogos
  const [catalogError, setCatalogError] = useState<string>('');

  // resultados
  const [items, setItems] = useState<CodeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // comparación (mínima estable)
  const [bulkInput, setBulkInput] = useState('');
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState('');
  const [noMatchText, setNoMatchText] = useState('');
  const [noMatchCount, setNoMatchCount] = useState(0);

  // libres para export
  const [libres, setLibres] = useState<LibreRow[]>([]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    try {
      const raw = localStorage.getItem('cosmosx_user');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.username) setUser(parsed);
      }
    } catch {}
  }, [mounted]);

  const handleLogout = () => {
    try {
      localStorage.removeItem('cosmosx_user');
      sessionStorage.removeItem('cosmosx_user');
    } catch {}
    window.location.href = '/login';
  };

  useEffect(() => {
    if (!user) return;
    setCatalogError('');

    const catalogUrl = `/codes/tools/dashboard/catalogs`;

    const fetchCatalogs = () => fetchJson<CatalogsResponse>(catalogUrl);

    fetchCatalogs()
      .catch(() => new Promise<CatalogsResponse>((resolve, reject) =>
        setTimeout(() => fetchCatalogs().then(resolve, reject), 500),
      ))
      .then((d: CatalogsResponse) => {
        if (d && d.ok === false) throw new Error(d.error ?? 'Respuesta ok:false del servidor');

        // Normalize: accept both { encargados } and { users } formats
        let list: string[] = [];
        if (Array.isArray(d?.users)) {
          list = d.users.filter(Boolean);
        } else if (Array.isArray(d?.encargados)) {
          list = d.encargados.map((e) => (typeof e === 'string' ? e : e.nombre)).filter(Boolean);
        }
        setUsuarios(list);

        // Normalize: accept both { subEncargados } and { subs } formats
        let subList: string[] = [];
        if (Array.isArray(d?.subs)) {
          subList = d.subs.filter(Boolean);
        } else if (Array.isArray(d?.subEncargados)) {
          subList = d.subEncargados.map((e) => (typeof e === 'string' ? e : e.nombre)).filter(Boolean);
        }
        setSubUsuarios(subList);

        if (!list.length && !subList.length) {
          setCatalogError('No se encontraron usuarios ni sub usuarios en el catálogo.');
        }
      })
      .catch((err) => {
        setUsuarios([]);
        setSubUsuarios([]);
        const msg = err?.message ?? '';
        const is404 = msg.includes('404');
        setCatalogError(
          is404
            ? `Endpoint de catálogos no existe: ${catalogUrl}. Verifica que el backend esté actualizado.`
            : `Catálogos: no se pudieron cargar los usuarios/subusuarios. ${msg || 'Verifica tu conexión o intenta más tarde.'}`,
        );
        if (process.env.NODE_ENV === 'development') {
          console.error('[asignaciones] Error cargando catálogos:', err);
        }
      });

    fetchJson<string[]>(`/codes/tools/states`)
      .then((d) => setEstados(Array.isArray(d) ? d : []))
      .catch((err) => {
        setEstados([]);
        setCatalogError((prev) =>
          prev
            ? `${prev} No se pudieron cargar los estados.`
            : `No se pudieron cargar los estados. ${err?.message ?? ''}`,
        );
        if (process.env.NODE_ENV === 'development') {
          console.error('[asignaciones] Error cargando estados:', err);
        }
      });
  }, [user]);

  useEffect(() => {
    if (!estado) {
      setMunicipios([]);
      setMunicipio('');
      return;
    }

    fetchJson<string[]>(`/codes/tools/municipalities?estado=${encodeURIComponent(estado)}`)
      .then((d) => setMunicipios(Array.isArray(d) ? d : []))
      .catch((err) => {
        setMunicipios([]);
        if (process.env.NODE_ENV === 'development') {
          console.error('[asignaciones] Error cargando municipios:', err);
        }
      });
  }, [estado]);

  function aplicar() {
    setLoading(true);
    setError('');
    setItems([]);
    setTotal(0);

    const qs = new URLSearchParams();
    if (usuario) qs.set('encargado', usuario);
    if (subUsuario) qs.set('encargado_anterior', subUsuario);
    if (estado) qs.set('estado', estado);
    if (municipio) qs.set('municipio', municipio);

    fetchJson<{ items?: CodeItem[]; total?: number }>(`/codes/assigned?${qs.toString()}`)
      .then((d) => {
        const list = Array.isArray(d?.items) ? d.items : [];
        const shouldFilterM13 = m13 === 'true' || m13 === 'false';
        const filteredItems = shouldFilterM13
          ? list.filter((it: CodeItem) => (m13 === 'true' ? it.m13 === true : it.m13 === false))
          : list;
        setItems(filteredItems);
        const baseTotal = Number(d?.total ?? list.length ?? 0);
        setTotal(shouldFilterM13 ? filteredItems.length : baseTotal);
        if (!filteredItems.length) setError('No hay resultados.');
      })
      .catch((err) => setError(err?.message ?? 'Error cargando resultados'))
      .finally(() => setLoading(false));
  }

  async function comparar() {
    setCompareLoading(true);
    setCompareError('');
    setNoMatchText('');
    setNoMatchCount(0);
    setLibres([]);

    try {
      const target = (usuario || '').trim();
      if (!target) throw new Error('Selecciona un Usuario arriba (filtros) para comparar contra ese usuario.');

      const cores = normalizeList(bulkInput);
      if (!cores.length) throw new Error('Pega una lista (uno por línea) con núcleos o PL completos.');

      const foundItems: CodeItem[] = await fetchJson<CodeItem[]>(`/codes/bulk-lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: cores }),
      });

      let out: string[] = [];
      let count = 0;
      const libresTemp: LibreRow[] = [];

      for (const core of cores) {
        const it = foundItems.find((x) => extractPureCode(x.code) === core) || null;

        if (!it) {
          count++;
          libresTemp.push({ core, status: 'NO_ENCONTRADO' });
          if (out.length < 150) out.push(`🟥 ${core}  |  NO ENCONTRADO`);
          continue;
        }

        const assigned = it.encargado_actual?.trim() ? it.encargado_actual.trim() : '';
        if (!assigned) {
          count++;
          libresTemp.push({ core, status: 'SIN_ASIGNAR' });
          if (out.length < 150) out.push(`🟩 ${core}  |  SIN ASIGNAR`);
          continue;
        }

        if (assigned !== target) {
          count++;
          if (out.length < 150) out.push(`${core}  |  ASIGNADO A: ${assigned}`);
        }
      }

      setNoMatchCount(count);
      setNoMatchText(out.join('\n'));
      setLibres(libresTemp);
    } catch (e: any) {
      setCompareError(e?.message || 'Error comparando');
    } finally {
      setCompareLoading(false);
    }
  }

  if (!mounted) return null;

  if (!user) {
    return (
      <main className="layout-main">
        <div className="layout-stack">
          <section className="home-card">
            <h1 className="home-title">Cargando sesión…</h1>
          </section>
        </div>
      </main>
    );
  }

  const resultadosFilename = `asignaciones_${usuario || 'todos'}_${estado || 'todos'}_${Date.now()}.csv`;
  const libresFilename = `libres_${usuario || 'usuario'}_${Date.now()}.csv`;

  return (
    <main className="layout-main">
      <div className="layout-stack">
        {/* DEBUG BANNER — solo visible si hay error */}
        {(catalogError || error || compareError) && (
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

        <AppHeader
          title="COSMOSX"
          subtitle="Asignaciones"
          user={{ username: user.username, role: user.role }}
          onLogout={handleLogout}
        />

        {/* FILTROS */}
        <section className="home-card">
          <div className="home-field-block">
            {catalogError && (
              <p className="home-error" style={{ marginBottom: 10 }}>{catalogError}</p>
            )}
            {/* Fila 1 */}
            <div className="assign-filters-grid">
              <select className="input-pill" value={usuario} onChange={(e) => setUsuario(e.target.value)}>
                <option value="">Usuario</option>
                {usuarios.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>

              <select className="input-pill" value={subUsuario} onChange={(e) => setSubUsuario(e.target.value)}>
                <option value="">Sub usuario</option>
                {subUsuarios.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>

              <select className="input-pill" value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="">Estado</option>
                {estados.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>

              <select className="input-pill" value={municipio} onChange={(e) => setMunicipio(e.target.value)} disabled={!estado}>
                <option value="">{estado ? 'Municipio' : 'Municipio (elige Estado)'}</option>
                {municipios.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>

              <select className="input-pill" value={m13} onChange={(e) => setM13(e.target.value)} aria-label="M13" title="M13">
                <option value="">—</option>
                <option value="true">Solo M13</option>
                <option value="false">Sin M13</option>
              </select>
            </div>

            {/* Fila 2 */}
            <div className="assign-actions-row" style={{ marginTop: 10 }}>
              <button className="btn-accent" type="button" onClick={aplicar} disabled={loading}>
                {loading ? '...' : 'Aplicar'}
              </button>

              {/* ✅ BOTÓN CSV DEL PRIMER PANEL */}
              {items.length > 0 ? (
                <button
                  className="home-config-btn"
                  type="button"
                  onClick={() => downloadCSV(resultadosFilename, toCSVResultados(items))}
                >
                  Descargar CSV
                </button>
              ) : null}
            </div>

            <div className="home-msg" style={{ marginTop: 10 }}>
              Total: <strong>{total}</strong>
            </div>

            {error ? <p className="home-error" style={{ marginTop: 10 }}>{error}</p> : null}
          </div>
        </section>

        {/* RESULTADOS */}
        {Array.isArray(items) && items.length > 0 ? (
          <section className="home-card">
            <h2 className="home-title" style={{ fontSize: 18 }}>Resultados</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.slice(0, 200).map((it) => (
                <div
                  key={it.id}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 12,
                    padding: 10,
                    background: '#fff',
                  }}
                >
                  <strong>{it.code}</strong>
                  <div style={{ fontSize: 12 }}>{it.razon_social ?? '—'}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {it.municipio ?? ''}{it.estado ? `, ${it.estado}` : ''}
                  </div>
                  <div style={{ fontSize: 12 }}>
                    Usuario: {it.encargado_actual ?? '—'}
                  </div>
                  <div style={{ fontSize: 12 }}>
                    Sub: {it.encargado_anterior ?? '—'}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* COMPARACIÓN */}
        <section className="home-card">
          <h2 className="home-title" style={{ fontSize: 18 }}>Comparar lista masiva vs Usuario seleccionado</h2>
          <p className="home-sub">🟩 SIN ASIGNAR · 🟥 NO ENCONTRADO</p>

          <div className="home-field-block">
            <div className="assign-actions-row">
              <button className="btn-accent" type="button" onClick={comparar} disabled={compareLoading}>
                {compareLoading ? '...' : 'Comparar'}
              </button>

              {libres.length > 0 ? (
                <button
                  className="home-config-btn"
                  type="button"
                  onClick={() => downloadCSV(libresFilename, toCSVLibres(libres))}
                >
                  Descargar libres (CSV)
                </button>
              ) : null}
            </div>

            <textarea
              className="admin-textarea"
              rows={6}
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              placeholder={'PL/6321/EXP/ES/2015\n7420\nPL/7246/EXP/ES/2015\n...'}
              style={{ marginTop: 10 }}
            />

            {compareError ? <p className="home-error" style={{ marginTop: 10 }}>{compareError}</p> : null}

            {noMatchCount > 0 ? (
              <div style={{ marginTop: 10 }}>
                <div className="home-msg">
                  NO MATCH encontrados: <strong>{noMatchCount}</strong> (mostrando hasta 150)
                </div>
                <pre
                  style={{
                    marginTop: 10,
                    whiteSpace: 'pre-wrap',
                    fontSize: 12,
                    background: '#fff',
                    border: '1px solid #e5e7eb',
                    padding: 10,
                    borderRadius: 12,
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  }}
                >
                  {noMatchText}
                </pre>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
