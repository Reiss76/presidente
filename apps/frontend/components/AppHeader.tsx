'use client';

import React, { useEffect, useState } from 'react';
import { FOCUSABLE_SELECTOR } from './focusableSelector';

type UserLite = { username: string; role: string } | null;
type NavItem = { key: string; label: string; href: string; icon: string };
type ActionItem = { key: string; label: string; onClick: () => void; icon: string };

export default function AppHeader(props: {
  title: string;
  subtitle?: string;
  user?: UserLite;

  onClear?: () => void;
  onLogout?: () => void;

  showHome?: boolean;
  homeHref?: string;

  showAsignaciones?: boolean;
  showAdmin?: boolean;
  showVisitas?: boolean;
  showDashboard?: boolean;
  showMapas?: boolean;

  backHref?: string;
  dashboardHref?: string;
}) {
  const {
    title,
    subtitle,
    user,
    onClear,
    onLogout,

    showHome = true,
    homeHref = '/',

    showAsignaciones,
    showAdmin,
    showVisitas,
    showDashboard,
    showMapas,

    backHref,
    dashboardHref = '/admin/dashboard',
  } = props;

  const [localUser, setLocalUser] = useState<UserLite>(user ?? null);

  useEffect(() => {
    setLocalUser(user ?? null);
  }, [user]);

  useEffect(() => {
    if (user) return;
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('cosmosx_user');
      if (raw) {
        const parsed = JSON.parse(raw) as any;
        if (
          parsed &&
          typeof parsed.username === 'string' &&
          parsed.username.trim() &&
          (parsed.role === 'admin' || parsed.role === 'editor')
        ) {
          setLocalUser({ username: parsed.username, role: parsed.role });
        }
      }
    } catch {
      setLocalUser(null);
    }
  }, [user]);

  const effectiveUser = user ?? localUser;

  // ✅ Dashboard: admin OR editor (a menos que showDashboard sea explícitamente false)
  const roleAllowsDashboard = effectiveUser?.role === 'admin' || effectiveUser?.role === 'editor';
  const shouldShowDashboard = showDashboard === false ? false : roleAllowsDashboard;

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const drawerRef = React.useRef<HTMLElement | null>(null);

  // Close on ESC
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMenuOpen]);

  // Focus first focusable inside drawer
  useEffect(() => {
    if (!isMenuOpen) return;
    const firstFocusable = drawerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    if (firstFocusable) firstFocusable.focus();
    else drawerRef.current?.focus();
  }, [isMenuOpen]);

  const navItems: NavItem[] = [];
  if (showHome) navItems.push({ key: 'home', label: 'Home', href: homeHref, icon: 'H' });
  if (backHref) navItems.push({ key: 'back', label: 'Volver', href: backHref, icon: 'V' });
  if (showAsignaciones) navItems.push({ key: 'asignaciones', label: 'Asignaciones', href: '/asignaciones', icon: 'A' });
  if (showAdmin) navItems.push({ key: 'admin', label: 'Configuración', href: '/admin', icon: 'C' });
  if (shouldShowDashboard) navItems.push({ key: 'dashboard', label: 'Dashboard', href: dashboardHref, icon: 'D' });
  if (showVisitas) navItems.push({ key: 'visitas', label: 'Visitas', href: '/visitas', icon: 'V' });
  if (showMapas) navItems.push({ key: 'mapas', label: 'Mapas', href: '/mapas', icon: 'M' });

  const actionItems: ActionItem[] = [];
  if (onClear) actionItems.push({ key: 'clear', label: 'Limpiar', onClick: onClear, icon: 'L' });
  if (onLogout) actionItems.push({ key: 'logout', label: 'Cerrar sesión', onClick: onLogout, icon: 'C' });

  const closeMenu = () => {
    setIsMenuOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <section className="home-card">
      <header className="home-header" style={{ gap: 12, alignItems: 'flex-start', justifyContent: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%' }}>
          {/* Hamburger */}
          <button
            type="button"
            aria-label={isMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((v) => !v)}
            ref={buttonRef}
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              border: '1px solid rgba(17,24,39,0.10)',
              background: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span aria-hidden="true" style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ width: 18, height: 2, borderRadius: 2, background: '#111827', display: 'block' }} />
              <span style={{ width: 18, height: 2, borderRadius: 2, background: '#111827', display: 'block' }} />
              <span style={{ width: 18, height: 2, borderRadius: 2, background: '#111827', display: 'block' }} />
            </span>
          </button>

          {/* Titles */}
          <div style={{ flex: 1 }}>
            <div className="home-tag">{title}</div>
            <h1 className="home-title" style={{ marginBottom: 4 }}>{subtitle || ''}</h1>
            {effectiveUser && (
              <p className="home-sub" style={{ marginTop: 0 }}>
                Sesión iniciada como {effectiveUser.username} ({effectiveUser.role})
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Drawer */}
      {isMenuOpen && (
        <>
          {/* Overlay */}
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={closeMenu}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.50)',
              zIndex: 9998,
              border: 'none',
              padding: 0,
              margin: 0,
            }}
          />

          <aside
            ref={drawerRef}
            tabIndex={-1}
            role="navigation"
            aria-label="Navegación principal"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              height: '100vh',
              width: 280,
              maxWidth: '80vw',
              background: '#0b0b0b',
              color: '#ffffff',
              zIndex: 9999,
              boxShadow: '16px 0 40px rgba(0,0,0,0.35)',
              display: 'flex',
              flexDirection: 'column',
              padding: '16px 14px',
              transform: 'translateX(0)',
              animation: 'appheaderSlideIn 180ms ease-out',
            }}
          >
            {/* Header row inside drawer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', opacity: 0.75 }}>
                Menú
              </div>
              <button
                type="button"
                onClick={closeMenu}
                aria-label="Cerrar menú"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.08)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.10)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            {/* Nav */}
            <nav style={{ marginTop: 14, display: 'flex', flexDirection: 'column' }}>
              {navItems.map((item) => (
                <a
                  key={item.key}
                  href={item.href}
                  onClick={closeMenu}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '12px 10px',
                    borderRadius: 12,
                    color: '#fff',
                    textDecoration: 'none',
                    fontSize: 14,
                    fontWeight: 600,
                    letterSpacing: '0.01em',
                    background: 'transparent',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      background: 'rgba(255,255,255,0.10)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  >
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </a>
              ))}
            </nav>

            {/* Divider */}
            {actionItems.length > 0 && (
              <div style={{ height: 1, background: 'rgba(255,255,255,0.10)', margin: '12px 0' }} />
            )}

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {actionItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    item.onClick();
                    closeMenu();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '12px 10px',
                    borderRadius: 12,
                    background: 'transparent',
                    color: '#fff',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 600,
                    letterSpacing: '0.01em',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      background: 'rgba(255,255,255,0.10)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  >
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            {/* Footer spacer */}
            <div style={{ marginTop: 'auto', paddingTop: 10, opacity: 0.65, fontSize: 11 }}>
              {effectiveUser ? `${effectiveUser.username} · ${effectiveUser.role}` : ''}
            </div>

            {/* Local keyframes without touching CSS files */}
            <style>{`
              @keyframes appheaderSlideIn {
                from { transform: translateX(-8px); opacity: 0.0; }
                to   { transform: translateX(0);   opacity: 1.0; }
              }
            `}</style>
          </aside>
        </>
      )}
    </section>
  );
}
