'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at 20% 20%, #1e1b4b, #0f172a)',
        color: '#e0e7ff',
        padding: 24,
        fontFamily: 'system-ui',
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: '100%',
          background: 'rgba(15, 23, 42, 0.75)',
          border: '1px solid rgba(148, 163, 184, 0.2)',
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>
          Algo no salió como esperábamos
        </h1>
        <p style={{ marginBottom: 16, lineHeight: 1.6 }}>
          Ocurrió un error inesperado. Nuestro equipo ya fue notificado. Podés intentar
          recargar la página o volver a intentarlo en unos segundos.
        </p>
        <button
          onClick={() => reset()}
          style={{
            marginTop: 12,
            padding: '12px 14px',
            borderRadius: 12,
            border: '1px solid #6366f1',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: 'white',
            fontWeight: 700,
            width: '100%',
            cursor: 'pointer',
            boxShadow: '0 10px 30px rgba(99,102,241,0.35)',
          }}
        >
          Recargar
        </button>
      </div>
    </main>
  );
}
