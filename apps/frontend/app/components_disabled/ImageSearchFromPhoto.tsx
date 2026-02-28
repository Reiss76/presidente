'use client';

import { useState } from 'react';

type CodeItem = {
  id: number;
  code: string;
  razon_social?: string | null;
  direccion?: string | null;
  estado?: string | null;
  municipio?: string | null;
  encargado_actual?: string | null;
};

const API_URL =
  'https://codes-backend-production.up.railway.app/codes/image-search';

export function ImageSearchFromPhoto() {
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [results, setResults] = useState<CodeItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<number, string>>({});

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setCodes([]);
    setResults([]);
    setError(null);
  };

  const handleUpload = async () => {
    if (!file) return;

    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(API_URL, {
        method: 'POST',
        body: formData,
      });

      const contentType = res.headers.get('content-type') || '';

      if (!res.ok) {
        if (contentType.includes('application/json')) {
          const data = await res.json();
          throw new Error(data.message || 'Error al procesar la imagen');
        } else {
          const text = await res.text();
          throw new Error(text || 'Error al procesar la imagen');
        }
      }

      const data = await res.json();
      setCodes(data.codes || []);
      setResults(data.results || []);
    } catch (err: any) {
      setError(err.message ?? 'Error inesperado');
    } finally {
      setIsLoading(false);
    }
  };

  // 👉 Ahora usamos direccion + municipio + estado para abrir Google Maps
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

  const handleCommentChange = (id: number, value: string) => {
    setComments((prev) => ({ ...prev, [id]: value }));
  };

  return (
    <div className="space-y-4">
      {/* Tarjeta principal de la sección */}
      <div
        className="rounded-3xl p-4 sm:p-5 shadow-sm border"
        style={{
          background:
            'linear-gradient(145deg, #f7f9ff 0%, #f9ffe8 45%, #ffffff 100%)',
          borderColor: '#e3e6f0',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-neutral-900">
              Buscar códigos desde una foto
            </h2>
            <p className="text-xs sm:text-sm text-neutral-600 mt-1 max-w-md">
              Toma una foto o sube una imagen donde aparezca el código{' '}
              <strong>PL/…</strong>. El sistema lo leerá y buscará
              automáticamente.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center mt-4">
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="text-xs sm:text-sm"
            style={{ maxWidth: '100%' }}
          />

          <button
            onClick={handleUpload}
            disabled={!file || isLoading}
            className="inline-flex items-center justify-center rounded-full px-4 py-2 text-xs sm:text-sm font-semibold text-neutral-900 disabled:opacity-50"
            style={{
              backgroundColor: '#d6ff4f',
              boxShadow: '0 8px 18px rgba(214, 255, 79, 0.45)',
            }}
          >
            {isLoading ? 'Leyendo imagen…' : 'Buscar en la foto'}
          </button>
        </div>

        {error && (
          <p className="text-xs sm:text-sm text-red-500 mt-3">{error}</p>
        )}

        {codes.length > 0 && (
          <p className="text-xs sm:text-sm text-neutral-700 mt-3">
            Códigos detectados:{' '}
            <span className="font-semibold">{codes.join(', ')}</span>
          </p>
        )}
      </div>

      {/* Resultados debajo, con tarjetas tipo dashboard y semáforo */}
      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((item) => {
            const hasEncargado = !!item.encargado_actual;
            const dotColor = hasEncargado ? '#22c55e' : '#ef4444'; // verde / rojo

            const hasAddress =
              item.direccion || item.municipio || item.estado;

            return (
              <div
                key={item.id}
                className="relative rounded-3xl border bg-white/80 px-4 py-3 sm:px-5 sm:py-4 cursor-pointer transition transform hover:-translate-y-0.5 hover:shadow-md"
                style={{ borderColor: '#e2e4ed' }}
                onClick={() => handleCardClick(item)}
              >
                {/* Semáforo */}
                <div className="absolute top-3 right-3 flex items-center gap-1">
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      backgroundColor: dotColor,
                      boxShadow: `0 0 0 3px ${
                        hasEncargado
                          ? 'rgba(34,197,94,0.18)'
                          : 'rgba(239,68,68,0.18)'
                      }`,
                    }}
                  />
                </div>

                <div className="flex flex-col gap-1 pr-8">
                  <div className="text-[13px] sm:text-sm font-semibold text-neutral-900">
                    {item.code}
                  </div>
                  <div className="text-[12px] sm:text-xs text-neutral-700">
                    {item.razon_social ?? '—'}
                  </div>
                  <div className="text-[11px] sm:text-[12px] text-neutral-500">
                    {item.direccion}
                    {(item.municipio || item.estado) && (
                      <>
                        {' · '}
                        {item.municipio ?? ''}
                        {item.estado ? `, ${item.estado}` : ''}
                      </>
                    )}
                  </div>

                  {/* Encargado */}
                  <div className="mt-1 text-[11px] sm:text-[12px] text-neutral-600">
                    Encargado:{' '}
                    <span className="font-medium">
                      {item.encargado_actual || 'Sin encargado asignado'}
                    </span>
                  </div>

                  {/* Comentarios (solo front por ahora) */}
                  <div className="mt-3">
                    <label className="block text-[11px] sm:text-[12px] text-neutral-500 mb-1">
                      Comentarios
                    </label>
                    <textarea
                      rows={2}
                      className="w-full rounded-2xl border px-2 py-1 text-[11px] sm:text-[12px] outline-none focus:ring-1"
                      style={{
                        borderColor: '#e2e4ed',
                        boxShadow: '0 0 0 0 rgba(0,0,0,0)',
                      }}
                      placeholder="Notas rápidas sobre este código…"
                      value={comments[item.id] || ''}
                      onChange={(e) =>
                        handleCommentChange(item.id, e.target.value)
                      }
                      onClick={(e) => e.stopPropagation()} // no abrir mapas al escribir
                    />
                  </div>

                  {/* Hint de Google Maps / Street */}
                  {hasAddress && (
                    <div className="mt-2 text-[11px] sm:text-[12px] text-neutral-500">
                      Toca la tarjeta para abrir Google Maps con esta
                      dirección y ver Street View.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
