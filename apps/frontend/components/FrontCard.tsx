'use client';

import React from 'react';

export default function FrontCard({ item }: { item: any }) {
  if (!item) return null;

  const hasUser = !!item.encargado_actual;
  const dotColor = hasUser ? '#22c55e' : '#ef4444';

  return (
    <article
      className="home-result-card"
      style={{
        position: 'relative',
        padding: '18px 20px',
        borderRadius: 18,
        background: '#f5f5f7',
        border: '1px solid rgba(148,163,184,0.35)',
        boxShadow: '0 10px 20px rgba(15,23,42,0.08)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {/* Semáforo */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          right: 14,
          width: 12,
          height: 12,
          borderRadius: 999,
          backgroundColor: dotColor,
          boxShadow: `0 0 0 3px ${
            hasUser ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'
          }`,
        }}
      />

      <div style={{ fontWeight: 600, fontSize: 14, color: '#111' }}>
        {item.code}
      </div>

      <div style={{ fontSize: 13, fontWeight: 500, color: '#1f2937' }}>
        {item.razon_social ?? '—'}
      </div>

      <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>
        {item.direccion}
        {(item.municipio || item.estado) && (
          <>
            {' · '}
            {item.municipio ?? ''}
            {item.estado ? ', ' + item.estado : ''}
          </>
        )}
      </div>

      {/* Usuario */}
      <div style={{ fontSize: 12, marginTop: 6, color: '#4b5563' }}>
        Usuario:{' '}
        <span style={{ fontWeight: 600 }}>
          {item.encargado_actual || 'Sin asignar'}
        </span>
      </div>

      {/* Sub usuario */}
      <div style={{ fontSize: 12, color: '#4b5563' }}>
        Sub:{' '}
        <span style={{ fontWeight: 600 }}>
          {item.encargado_anterior || '—'}
        </span>
      </div>

      {/* Comentario */}
      {item.comentario && (
        <div style={{ fontSize: 12, marginTop: 4, color: '#4b5563' }}>
          Comentario:{' '}
          <span style={{ fontWeight: 500 }}>{item.comentario}</span>
        </div>
      )}
    </article>
  );
}
