'use client';

import React, { useEffect, useState } from 'react';
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
  estado?: string | null;
  municipio?: string | null;
  direccion?: string | null;
  grupo_id?: number | null;
  encargado_actual?: string | null;   // Usuario
  encargado_anterior?: string | null; // Sub
  comentario?: string | null;         // Comentario
};

const API = getApiBase();

export default function HomeInner() {
  // -----------------------
  // AUTH PARA MAIN PAGE
  // -----------------------
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('cosmosx_user');
      if (raw) {
        const user = JSON.parse(raw) as AuthUser;
        if (user && user.username) {
          setCurrentUser(user);
        }
      }
    } catch {
      // ignorar errores de parseo
    } finally {
      setAuthChecked(true);
    }
  }, []);

  if (!authChecked) {
    return null; // mientras revisamos localStorage
  }

  if (!currentUser) {
    return (
      <main className="layout-main">
        <div className="layout-stack">
          <section className="home-card" style={{ maxWidth: 420, margin: '0 auto' }}>
            <div className="home-tag">COSMOSX</div>
            <h1 className="home-title">ACCESO REQUERIDO</h1>
            <p className="home-sub">
              Para usar el buscador necesitas iniciar sesión.
            </p>
            <a href="/login" className="home-config-btn" style={{ marginTop: 16 }}>
              Ir a login
            </a>
          </section>
        </div>
      </main>
    );
  }

  // -----------------------
  //  STATE PRINCIPAL
  // -----------------------
  const [codeQuery, setCodeQuery] = useState('');
  const [textQuery, setTextQuery] = useState('');
  const [results, setResults] = useState<CodeItem[]>([]);
  const [bulkInput, setBulkInput] = useState('');
  const [bulkResults, setBulkResults] = useState<CodeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  // Foto / OCR
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageCodes, setImageCodes] = useState<string[]>([]);

  // -----------------------
  //  RESET DE BÚSQUEDAS
  // -----------------------
  function resetAll() {
    setCodeQuery('');
    setTextQuery('');
    setResults([]);
    setBulkInput('');
    setBulkResults([]);
    setError(null);
    setBulkError(null);
    setBulkMessage(null);
    setImageFile(null);
    setImageError(null);
    setImageCodes([]);
  }

  // -----------------------
  //  BUSCAR POR CÓDIGO
  // -----------------------
  async function handleCodeSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = codeQuery.trim();
    if (!trimmed) return;

    try {
      setLoading(true);
      setError(null);
      setBulkError(null);
      setBulkMessage(null);
      setResults([]);
      setBulkResults([]);

      const data = await fetchJson<CodeItem | null>(
        `/codes/by-code?code=${encodeURIComponent(trimmed)}`,
      );

      const items: CodeItem[] = data ? [data] : [];
      setResults(items);
      if (!items.length) {
        setError(`No se encontró el código "${trimmed}".`);
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? 'Error al buscar.');
    } finally {
      setLoading(false);
    }
  }

  // -----------------------
  //  BUSCAR POR TEXTO
  // -----------------------
  async function handleTextSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = textQuery.trim();
    if (!trimmed) return;

    try {
      setLoading(true);
      setError(null);
      setBulkError(null);
      setBulkMessage(null);
      setResults([]);
      setBulkResults([]);

      const data = await fetchJson<CodeItem[] | { items: CodeItem[] }>(
        `/codes?query=${encodeURIComponent(trimmed)}`,
      );

      const items: CodeItem[] = Array.isArray(data)
        ? data
        : ('items' in data ? data.items : []);

      setResults(items);
      if (!items.length) {
        setError(`No se encontraron resultados para "${trimmed}".`);
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? 'Error al buscar.');
    } finally {
      setLoading(false);
    }
  }

  // -----------------------
  //  BÚSQUEDA EN LOTE
  // -----------------------
  async function handleBulkSearch(e: React.FormEvent) {
    e.preventDefault();
    const lines = bulkInput
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length);

    if (!lines.length) {
      setBulkResults([]);
      setResults([]);
      setBulkError('Pega al menos un código.');
      return;
    }

    try {
      setLoading(true);
      setBulkError(null);
      setBulkMessage(null);
      setError(null);
      setResults([]);

      const data = await fetchJson<CodeItem[]>(`/codes/bulk-lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: lines }),
      });
      setBulkResults(data);
      setResults(data);
      if (!data.length) {
        setBulkError('Ninguno de los códigos fue encontrado.');
      } else {
        setBulkMessage(`Se encontraron ${data.length} códigos.`);
      }
    } catch (err: any) {
      console.error(err);
      setBulkError(err?.message ?? 'Error al buscar lista.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  // -----------------------
  //  BÚSQUEDA DESDE FOTO
  // -----------------------
  function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setImageFile(f);
    setImageError(null);
    setImageCodes([]);
  }

  async function handleImageSearch() {
    if (!imageFile) return;
    try {
      setImageLoading(true);
      setImageError(null);
      setError(null);
      setBulkError(null);
      setBulkMessage(null);
      setResults([]);
      setBulkResults([]);

      const formData = new FormData();
      formData.append('file', imageFile);

      const data = await fetchJson<{ codes?: string[]; results?: CodeItem[] }>(
        `/codes/image-search`,
        { method: 'POST', body: formData },
      );
      setImageCodes(data.codes || []);
      setResults(data.results || []);
      setBulkResults([]);
    } catch (err: any) {
      console.error(err);
      setImageError(err.message ?? 'Error al procesar la imagen');
    } finally {
      setImageLoading(false);
    }
  }

  // -----------------------
  //  CLICK EN TARJETA → Google Maps
  // -----------------------
  const handleCardClick = (item: CodeItem) => {
    const parts = [item.direccion, item.municipio, item.estado].filter(
      Boolean,
    );
    if (!parts.length) return;
    const query = parts.join(', ');
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      query,
    )}`;
    window.open(url, '_blank');
  };

  // -----------------------
  //  EXPORTAR CSV / PDF
  // -----------------------
  function getCurrentList(): CodeItem[] {
    return results.length ? results : bulkResults;
  }

  function exportCsv() {
    const data = getCurrentList();
    if (!data.length) return;

    const headers = [
      'Codigo',
      'Razon social',
      'Direccion',
      'Municipio',
      'Estado',
      'Usuario',
      'Sub',
      'Comentario',
    ];

    const lines = [headers.join(',')];

    for (const item of data) {
      const row = [
        item.code || '',
        item.razon_social || '',
        item.direccion || '',
        item.municipio || '',
        item.estado || '',
        item.encargado_actual || '',
        item.encargado_anterior || '',
        item.comentario || '',
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
      lines.push(row.join(','));
    }

    const csv = lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'cosmosx_resultados.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    const data = getCurrentList();
    if (!data.length) return;

    const win = window.open('', '_blank');
    if (!win) return;

    const rowsHtml = data
      .map(
        (item) => `
      <tr>
        <td>${item.code || ''}</td>
        <td>${item.razon_social || ''}</td>
        <td>${item.direccion || ''}</td>
        <td>${item.municipio || ''}</td>
        <td>${item.estado || ''}</td>
        <td>${item.encargado_actual || ''}</td>
        <td>${item.encargado_anterior || ''}</td>
        <td>${item.comentario || ''}</td>
      </tr>
    `,
      )
      .join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charSet="utf-8" />
        <title>Resultados CosmosX</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; padding: 24px; }
          h1 { font-size: 20px; margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
          th { background-color: #f3f4f6; }
        </style>
      </head>
      <body>
        <h1>Resultados de búsqueda – CosmosX</h1>
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Razón social</th>
              <th>Dirección</th>
              <th>Municipio</th>
              <th>Estado</th>
              <th>Usuario</th>
              <th>Sub</th>
              <th>Comentario</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
      </html>
    `;

    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  const listToRender = getCurrentList();

  // -----------------------
  //  UI DEL BUSCADOR
  // -----------------------
  return (
    <main className="layout-main">
      <div className="layout-stack">
        {/* DEBUG BANNER — solo visible si hay error */}
        {(error || bulkError || imageError) && (
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
        {/* CARD PRINCIPAL */}
        <section className="main-card home-card">
          <header className="home-header">
            <div>
              <div className="home-tag">COSMOSX</div>
              <h1 className="home-title">BUSCADOR</h1>
              <p className="home-sub">
                Usa la barra de <strong>código</strong> o la barra de texto para
                buscar por razón social, dirección, municipio o estado.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Botón Refresh */}
              <button
                type="button"
                onClick={resetAll}
                aria-label="Limpiar búsquedas"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  border: '1px solid #d1d5db',
                  background: '#f9fafb',
                  cursor: 'pointer',
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="#6b7280"
                  style={{ width: 18, height: 18 }}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v6h6M20 20v-6h-6M5.64 18.36A9 9 0 0118.36 5.64M18.36 18.36A9 9 0 015.64 5.64"
                  />
                </svg>
              </button>

              {/* Botón Config */}
              <a href="/admin" className="home-config-btn">
                Configuración
              </a>
            </div>
          </header>

          {/* BUSCAR POR CÓDIGO */}
          <form onSubmit={handleCodeSearch} className="home-field-block">
            <label className="home-label">Buscar por código</label>
            <div className="home-input-row">
              <input
                value={codeQuery}
                onChange={(e) => setCodeQuery(e.target.value)}
                placeholder="Ej. 2323"
                className="input-pill"
              />
              <button className="btn-accent">Buscar</button>
            </div>
          </form>

          {/* BUSCAR POR TEXTO */}
          <form onSubmit={handleTextSearch} className="home-field-block">
            <label className="home-label">
              Buscar por razón social / domicilio
            </label>
            <div className="home-input-row">
              <input
                value={textQuery}
                onChange={(e) => setTextQuery(e.target.value)}
                placeholder="Ej. ORSAN DEL NORTE..."
                className="input-pill"
              />
              <button className="btn-accent">Buscar</button>
            </div>
          </form>

          {/* MENSAJES */}
          {loading && <p className="home-msg">Buscando…</p>}
          {error && <p className="home-error">{error}</p>}

          {/* BOTONES DE EXPORTACIÓN */}
          {listToRender.length > 0 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 8,
                marginBottom: 4,
              }}
            >
              <button
                type="button"
                onClick={exportCsv}
                className="btn-accent"
                style={{
                  padding: '6px 12px',
                  fontSize: 11,
                  background: '#e5e7eb',
                  color: '#111827',
                }}
              >
                Descargar CSV
              </button>
              <button
                type="button"
                onClick={exportPdf}
                className="btn-accent"
                style={{
                  padding: '6px 12px',
                  fontSize: 11,
                  background: '#111827',
                  color: '#f9fafb',
                }}
              >
                Imprimir / PDF
              </button>
            </div>
          )}

          {/* RESULTADOS */}
          <div className="home-results">
            {listToRender.map((item) => {
              const hasUsuario = !!item.encargado_actual;
              const dotColor = hasUsuario ? '#22c55e' : '#ef4444';

              return (
                <article
                  key={item.id}
                  className="home-result-card"
                  onClick={() => handleCardClick(item)}
                >
                  <div
                    className="status-dot"
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      backgroundColor: dotColor,
                      boxShadow: `0 0 0 3px ${
                        hasUsuario
                          ? 'rgba(34,197,94,0.22)'
                          : 'rgba(239,68,68,0.22)'
                      }`,
                    }}
                  />
                  <div className="home-result-code">{item.code}</div>
                  <div className="home-result-sub">
                    {item.razon_social ?? '—'}
                  </div>
                  <div className="home-result-meta">
                    {item.direccion}
                    {(item.municipio || item.estado) && (
                      <>
                        {' '}
                        · {item.municipio ?? ''}
                        {item.estado ? ', ' + item.estado : ''}
                      </>
                    )}
                  </div>
                  <div className="home-result-meta" style={{ marginTop: 4 }}>
                    Usuario:{' '}
                    <span style={{ fontWeight: 500 }}>
                      {item.encargado_actual || 'Sin asignar'}
                    </span>
                  </div>
                  <div className="home-result-meta" style={{ marginTop: 2 }}>
                    Sub:{' '}
                    <span style={{ fontWeight: 500 }}>
                      {item.encargado_anterior || '—'}
                    </span>
                  </div>
                  {item.comentario && (
                    <div className="home-result-meta" style={{ marginTop: 2 }}>
                      Comentario:{' '}
                      <span style={{ fontWeight: 400 }}>
                        {item.comentario}
                      </span>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        {/* BÚSQUEDA MASIVA */}
        <section className="main-card home-card">
          <div className="home-label" style={{ marginBottom: 6 }}>
            Búsqueda en lote
          </div>
          <p className="home-sub" style={{ marginBottom: 10 }}>
            Pega una lista de códigos (uno por línea):
          </p>

          <form onSubmit={handleBulkSearch} className="bulk-form">
            <textarea
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              placeholder={'PL/12345/EXP/ES/2023\nPL/99822/EXP/ES/2015\n...'}
              rows={3}
              className="admin-textarea"
            />
            <button
              type="submit"
              className="home-bulk-btn"
              style={{ background: '#000', color: '#fff' }}
            >
              Buscar en lote
            </button>
          </form>

          {bulkError && <p className="home-error">{bulkError}</p>}
          {bulkMessage && <p className="home-msg">{bulkMessage}</p>}
        </section>

        {/* BÚSQUEDA DESDE FOTO */}
        <section className="main-card home-card">
          <h2 className="home-label">Buscar códigos desde una foto</h2>
          <p className="home-sub" style={{ marginBottom: 10 }}>
            Sube una foto donde aparezcan códigos PL/... El sistema hará OCR y
            buscará automáticamente.
          </p>

          <div className="home-field-block">
            <div className="home-input-row">
              <input
                type="file"
                accept="image/*"
                onChange={handleImageFileChange}
                className="input-pill"
                style={{ padding: 8, fontSize: 12 }}
              />
              <button
                type="button"
                className="btn-accent"
                onClick={handleImageSearch}
                disabled={!imageFile || imageLoading}
              >
                {imageLoading ? 'Leyendo…' : 'Buscar en foto'}
              </button>
            </div>
          </div>

          {imageError && (
            <p className="home-error" style={{ marginTop: 8 }}>
              {imageError}
            </p>
          )}

          {imageCodes.length > 0 && (
            <p className="home-msg" style={{ marginTop: 8 }}>
              Códigos detectados en la imagen:{' '}
              <strong>{imageCodes.join(', ')}</strong>
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
