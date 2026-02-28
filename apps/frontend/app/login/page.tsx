'use client';

import React, { useEffect, useState } from 'react';

type AuthUser = {
  id: number;
  username: string;
  role: string;
};

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Si ya hay sesión, mandar directo a /
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const hasSession = document.cookie.includes('cosmosx_session=');
      if (hasSession) {
        window.location.href = '/';
      }
    } catch {
      // ignorar
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    const u = username.trim();
    const p = password.trim();
    if (!u || !p) {
      setErrorMsg('Ingresa usuario y contraseña.');
      return;
    }

    try {
      setLoading(true);

      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setErrorMsg(data.message || 'Usuario o contraseña incorrectos.');
        return;
      }

      // Opcional: guardar info de usuario en localStorage para mostrar nombre
      if (typeof window !== 'undefined') {
        const user: AuthUser = data.user;
        window.localStorage.setItem('cosmosx_user', JSON.stringify(user));
      }

      // Redirigir al home (middleware ya dejará pasar)
      window.location.href = '/';
    } catch (err) {
      console.error(err);
      setErrorMsg('No se pudo conectar al servidor.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="layout-main">
      <div className="layout-stack">
        <section className="home-card" style={{ maxWidth: 420, margin: '0 auto' }}>
          <div className="home-tag">COSMOSX</div>
          <h1 className="home-title">ACCESO</h1>
          <p className="home-sub">
            Ingresa tus credenciales para entrar al sistema.
          </p>

          <form onSubmit={handleSubmit} className="home-field-block" style={{ marginTop: 20 }}>
            <label className="home-label" htmlFor="username">Usuario</label>
            <input
              id="username"
              name="username"
              className="input-pill"
              placeholder="usuario"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />

            <label className="home-label" htmlFor="password" style={{ marginTop: 12 }}>
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              className="input-pill"
              type="password"
              placeholder="••••••"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            {errorMsg && (
              <p className="home-error" style={{ marginTop: 10 }}>{errorMsg}</p>
            )}

            <button
              className="btn-accent"
              type="submit"
              disabled={loading}
              style={{ marginTop: 16 }}
            >
              {loading ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
