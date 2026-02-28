'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../lib/api';

const API = getApiBase();

type DashboardItem = {
  id: number;
  code: string;
  razon_social?: string | null;
  estado?: string | null;
  municipio?: string | null;
  encargado_actual?: string | null;
};

type DashboardData = {
  total: number;
  asignados: number;
  sinAsignar: number;
  porUsuario: Record<string, number>;
  porEstado: Record<string, number>;
  porMunicipio: Record<string, number>;
  items: DashboardItem[];
};

export default function DashboardAdmin() {
  // Filtros activos
  const [usuario, setUsuario] = useState('');
  const [estado, setEstado] = useState('');
  const [municipio, setMunicipio] = useState('');

  // Datos actuales según filtros
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Meta para selects
  const [metaUsuarios, setMetaUsuarios] = useState<string[]>([]);
  const [metaEstados, setMetaEstados] = useState<string[]>([]);
  const [metaMunicipiosPorEstado, setMetaMunicipiosPorEstado] = useState<
    Record<string, string[]>
  >({});

  // ===============================
  // Cargar meta (sin filtros)
  // ===============================
  async function loadMeta() {
    try {
      const res = await fetch(`${API}/codes/tools/dashboard`, { credentials: 'include' });
      if (!res.ok) throw new Error('meta');
      const json = (await res.json()) as DashboardData;

      // Usuarios desde porUsuario (sin SIN ASIGNAR)
      const usuarios = Object.keys(json.porUsuario || {})
        .filter((u) => u && u.toUpperCase() !== 'SIN ASIGNAR')
        .sort((a, b) => a.localeCompare(b, 'es'));

      // Estados desde porEstado (sin SIN ESTADO)
      const estados = Object.keys(json.porEstado || {})
        .filter((e) => e && e.toUpperCase() !== 'SIN ESTADO')
        .sort((a, b) => a.localeCompare(b, 'es'));

      // Municipios por estado a partir de items
      const muniMap: Record<string, Set<string>> = {};
      for (const item of json.items || []) {
        const est = (item.estado || 'SIN ESTADO').trim();
        const mun = (item.municipio || 'SIN MUNICIPIO').trim();
        if (!muniMap[est]) muniMap[est] = new Set();
        muniMap[est].add(mun);
      }

      const muniFinal: Record<string, string[]> = {};
      for (const [est, setM] of Object.entries(muniMap)) {
        muniFinal[est] = Array.from(setM).sort((a, b) => a.localeCompare(b, 'es'));
      }

      setMetaUsuarios(usuarios);
      setMetaEstados(estados);
      setMetaMunicipiosPorEstado(muniFinal);
    } catch (err) {
      console.error('loadMeta', err);
      // No es crítico si falla.
    }
  }

  // ===============================
  // Cargar datos con filtros
  // ===============================
  async function loadDashboard(e?: React.FormEvent) {
    if (e) e.preventDefault();

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (usuario.trim()) params.append('usuario', usuario.trim());
      if (estado.trim()) params.append('estado', estado.trim());
      if (municipio.trim()) params.append('municipio', municipio.trim());

      const url = `${API}/codes/tools/dashboard${params.toString() ? `?${params.toString()}` : ''}`;

      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('dashboard');

      const json = (await res.json()) as DashboardData;
      setData(json);
    } catch (err) {
      console.error('loadDashboard', err);
      setError('Error cargando datos del dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMeta();
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cuando cambia estado, reset municipio
  useEffect(() => {
    setMunicipio('');
  }, [estado]);

  // Municipios disponibles según estado
  const municipiosOptions = useMemo(() => {
    if (!estado) return [];
    return metaMunicipiosPorEstado[estado] || [];
  }, [estado, metaMunicipiosPorEstado]);

  // Municipios por estado (con los items actuales filtrados)
  const municipiosPorEstadoActual = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    if (!data?.items) return map;

    for (const item of data.items) {
      const est = (item.estado || 'SIN ESTADO').trim();
      const mun = (item.municipio || 'SIN MUNICIPIO').trim();
      if (!map[est]) map[est] = {};
      map[est][mun] = (map[est][mun] || 0) + 1;
    }
    return map;
  }, [data]);

  // Orden bonito: estados por cantidad desc
  const estadosOrdenados = useMemo(() => {
    if (!data?.porEstado) return [];
    return Object.entries(data.porEstado).sort((a, b) => (b[1] || 0) - (a[1] || 0));
  }, [data]);

  // Orden bonito: colaboradores por cantidad desc (sin SIN ASIGNAR)
  const colaboradoresOrdenados = useMemo(() => {
    if (!data?.porUsuario) return [];
    return Object.entries(data.porUsuario)
      .filter(([u]) => (u || '').toUpperCase() !== 'SIN ASIGNAR')
      .sort((a, b) => (b[1] || 0) - (a[1] || 0));
  }, [data]);

  return (
    <section className="admin-card">
      <h2 className="admin-list-title">Dashboard de códigos</h2>
      <p className="admin-note">
        Filtros combinables por usuario asignado, estado y municipio. Solo visible para Colaboradores Administradores.
      </p>

      {/* FILTROS */}
      <form
        onSubmit={loadDashboard}
        style={{
          marginTop: 12,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
        }}
      >
        {/* Usuario */}
        <select
          className="admin-select admin-input-pill"
          style={{ minWidth: 160, flex: '1 1 160px' }}
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
        >
          <option value="">Todos los colaboradores</option>
          {metaUsuarios.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>

        {/* Estado */}
        <select
          className="admin-select admin-input-pill"
          style={{ minWidth: 160, flex: '1 1 160px' }}
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
        >
          <option value="">Todos los estados</option>
          {metaEstados.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>

        {/* Municipio */}
        <select
          className="admin-select admin-input-pill"
          style={{ minWidth: 160, flex: '1 1 160px' }}
          value={municipio}
          onChange={(e) => setMunicipio(e.target.value)}
          disabled={!estado || municipiosOptions.length === 0}
        >
          <option value="">
            {estado
              ? municipiosOptions.length
                ? 'Todos los municipios'
                : 'Sin municipios'
              : 'Selecciona un estado'}
          </option>
          {municipiosOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <button
          type="submit"
          className="admin-btn"
          style={{ minWidth: 160 }}
          disabled={loading}
        >
          {loading ? 'Filtrando…' : 'Aplicar filtros'}
        </button>
      </form>

      {loading && (
        <p className="admin-status admin-status-muted" style={{ marginTop: 8 }}>
          Cargando…
        </p>
      )}
      {error && (
        <p className="admin-status admin-status-error" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}

      {/* CONTENIDO */}
      {data && (
        <div style={{ marginTop: 16 }}>
          {/* KPIs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div style={{ flex: '1 1 160px', padding: 12, borderRadius: 14, background: '#f9fafb', border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#6b7280' }}>Total códigos</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{data.total}</div>
            </div>

            <div style={{ flex: '1 1 160px', padding: 12, borderRadius: 14, background: '#ecfdf3', border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#166534' }}>Asignados</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{data.asignados}</div>
            </div>

            <div style={{ flex: '1 1 160px', padding: 12, borderRadius: 14, background: '#fef2f2', border: '1px solid #fecaca' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#b91c1c' }}>Sin asignar</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{data.sinAsignar}</div>
            </div>
          </div>

          {/* CÓDIGOS POR COLABORADOR (tarjetas) */}
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 10 }}>
              Códigos por colaborador
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {colaboradoresOrdenados.map(([u, total]) => (
                <div
                  key={u}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e5e7eb',
                    borderRadius: 14,
                    padding: '10px 14px',
                    minWidth: 120,
                    boxShadow: '0 10px 20px rgba(15, 23, 42, 0.06)',
                  }}
                >
                  <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6b7280' }}>
                    {u}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', marginTop: 2 }}>
                    {total}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* POR ESTADO + MUNICIPIOS (tarjetas) */}
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 10 }}>
              Códigos por estado y municipio
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {estadosOrdenados.map(([est, count]) => {
                const municipiosDeEsteEstado = municipiosPorEstadoActual[est] || {};
                const municipiosOrdenados = Object.entries(municipiosDeEsteEstado).sort((a, b) => (b[1] || 0) - (a[1] || 0));

                return (
                  <div
                    key={est}
                    style={{
                      flex: '1 1 240px',
                      minWidth: 240,
                      background: '#f9fafb',
                      borderRadius: 16,
                      border: '1px solid #e5e7eb',
                      padding: 12,
                    }}
                  >
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.10em', color: '#6b7280' }}>
                      Estado
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>
                      {est}
                    </div>
                    <div style={{ fontSize: 12, color: '#374151', marginTop: 4, marginBottom: 10 }}>
                      Total: <strong>{count}</strong>
                    </div>

                    {/* Municipios como “tarjetitas” pequeñas */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {municipiosOrdenados.map(([mun, c]) => (
                        <div
                          key={mun}
                          style={{
                            padding: '5px 8px',
                            borderRadius: 9999,
                            background: '#e0f2fe', // azul suave
                            border: '1px solid rgba(2, 132, 199, 0.18)',
                            color: '#0f172a',
                            fontSize: 11,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {mun}: <strong>{c}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
