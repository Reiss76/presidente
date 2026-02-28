'use client';

import React from 'react';

export default function Modal(props: {
  open: boolean;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  const { open, title, subtitle, onClose, children, maxWidth = 880 } = props;
  if (!open) return null;

  return (
    <div
      onClick={onClose}
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
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth,
          background: '#fff',
          borderRadius: 18,
          border: '1px solid #e5e7eb',
          boxShadow: '0 18px 60px rgba(0,0,0,0.25)',
          overflow: 'hidden',
        }}
      >
        {(title || subtitle) && (
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
              {title && <div style={{ fontSize: 14, fontWeight: 900 }}>{title}</div>}
              {subtitle && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{subtitle}</div>}
            </div>

            <button
              type="button"
              className="home-config-btn"
              style={{ background: '#111827', color: '#fff' }}
              onClick={onClose}
            >
              Cerrar
            </button>
          </div>
        )}

        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}
