'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ fontFamily: 'system-ui', padding: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800 }}>Error de aplicación</h2>
        <p style={{ opacity: 0.7 }}>
          (Esto solo lo ve quien tenga el link; sirve para diagnosticar.)
        </p>
        <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>
          {String(error?.message || error)}
          {error?.digest ? `\n\ndigest: ${error.digest}` : ''}
        </pre>
        <button
          onClick={() => reset()}
          style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid #ddd' }}
        >
          Reintentar
        </button>
      </body>
    </html>
  );
}
