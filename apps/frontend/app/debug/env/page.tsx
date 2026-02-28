'use client';

import React from 'react';

export default function DebugEnvPage() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const keyExists = !!apiKey;
  const keyPreview = keyExists && apiKey ? `${apiKey.substring(0, 6)}…` : '';

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <h1 style={{ marginBottom: '1rem' }}>Environment Variables Debug</h1>
      <div style={{ fontSize: '1.2rem' }}>
        NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: {keyExists ? '✅' : '❌'}{' '}
        {keyExists && `(${keyPreview})`}
      </div>
    </div>
  );
}
