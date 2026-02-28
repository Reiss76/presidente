'use client';

import React, { useEffect, useState } from 'react';
import AdminPanel from '../../components/AdminPanel';
import CreateCodeCard from '../../components/CreateCodeCard';
import AppHeader from '../../components/AppHeader';

type AuthUser = {
  id: number;
  username: string;
  role: string;
};

export default function AdminPage() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const raw = window.localStorage.getItem('cosmosx_user');
      if (raw) {
        const user = JSON.parse(raw) as AuthUser;
        if (user?.username) setCurrentUser(user);
      }
    } catch {
      // ignore
    } finally {
      setAuthChecked(true);
    }
  }, []);

  function handleLogout() {
    try {
      window.localStorage.removeItem('cosmosx_user');
      document.cookie = 'cosmosx_session=; Max-Age=0; path=/; secure; sameSite=lax;';
    } catch {}
    window.location.href = '/login';
  }

  if (!authChecked) return null;

  if (!currentUser) {
    return (
      <main className="admin-layout">
        <div className="admin-inner">
          <section className="admin-card">
            <h1 className="admin-title">Acceso restringido</h1>
            <p className="admin-subtitle">Esta sección requiere iniciar sesión.</p>
            <a href="/login" className="admin-topbar-btn">
              Ir a login
            </a>
          </section>
        </div>
      </main>
    );
  }

  // ✅ menú unificado siempre visible
  return (
    <main className="admin-layout">
      <div className="admin-inner">
        <AppHeader
          title="COSMOSX"
          subtitle="Configuración"
          user={{ username: currentUser.username, role: currentUser.role }}
          onLogout={handleLogout}
        />

        {/* ✅ Cargar nuevo código arriba */}
        <CreateCodeCard />

        {/* ✅ Panel principal (sin header interno) */}
        <AdminPanel currentUser={currentUser} />
      </div>
    </main>
  );
}
