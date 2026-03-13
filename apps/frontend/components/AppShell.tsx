'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import AppNav, { NavItem } from './AppNav';

type UserLite = { username?: string | null; role?: string | null } | null;

function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AppShell({
  title,
  subtitle,
  rightActions,
  children,
  user = null,
  userLabel,
  userRole,
  monochromeButtons = true,
  darkMode = false,
}: {
  title: string;
  subtitle?: string;
  user?: UserLite;
  userLabel?: string; // ej: "Sesión iniciada como cosmosx (admin)"
  userRole?: string; // ej: "admin" | "editor"
  rightActions?: React.ReactNode;
  children: React.ReactNode;
  monochromeButtons?: boolean;
  darkMode?: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [localUser, setLocalUser] = useState<UserLite>(null);

  // Save sidebar state to localStorage
  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const newState = !prev;
      try {
        window.localStorage.setItem('sidebarCollapsed', String(newState));
      } catch {
        // Ignore errors
      }
      return newState;
    });
  };

  useEffect(() => {
    if (user != null) return;
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('cosmosx_user');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed.username === 'string' &&
          parsed.username.trim() &&
          (parsed.role === 'admin' || parsed.role === 'editor')
        ) {
          setLocalUser(parsed);
        }
      }
    } catch {
      setLocalUser(null);
    }
  }, [user]);

  const effectiveUser = user || localUser;
  const effectiveUserLabel = useMemo(() => {
    if (userLabel !== undefined) return userLabel;
    if (effectiveUser?.username) return `Sesión iniciada como ${effectiveUser.username} (${effectiveUser.role})`;
    return undefined;
  }, [effectiveUser, userLabel]);

  const pathname = usePathname();

  const navItems: NavItem[] = useMemo(() => {
    const items: NavItem[] = [
      {
        label: 'Home',
        href: '/',
        icon: <Icon d="M3 12l2-2 4 4 8-8 4 4" />,
      },
      {
        label: 'Asignaciones',
        href: '/asignaciones',
        icon: <Icon d="M9 11l3 3L22 4" />,
      },
      {
        label: 'Configuración',
        href: '/admin',
        icon: <Icon d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm8-3.5a7.9 7.9 0 0 0-.1-1l2-1.5-2-3.5-2.3.8a8 8 0 0 0-1.7-1l-.3-2.4H10l-.3 2.4a8 8 0 0 0-1.7 1L5.7 6l-2 3.5 2 1.5a7.9 7.9 0 0 0 0 2l-2 1.5 2 3.5 2.3-.8a8 8 0 0 0 1.7 1L10 22h4l.3-2.4a8 8 0 0 0 1.7-1l2.3.8 2-3.5-2-1.5c.1-.3.1-.7.1-1z" />,
      },
    ];

    const effectiveRole = userRole ?? effectiveUser?.role;
    if (effectiveRole === 'admin' || effectiveRole === 'editor') {
      items.push({
        label: 'Dashboard',
        href: '/admin/dashboard',
        icon: <Icon d="M3 13h8V3H3v10zm10 8h8V3h-8v18zM3 21h8v-6H3v6z" />,
      });
    }

    items.push(
      {
        label: 'Visitas',
        href: '/visitas',
        icon: <Icon d="M8 7V3m8 4V3M4 11h16M6 21h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2" />,
      },
      {
        label: 'Mapas',
        href: '/mapas',
        icon: <Icon d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z M12 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" />,
      },
    );

    return items;
  }, [effectiveUser?.role, userRole]);

  return (
    <div className={`cx-shell ${monochromeButtons ? 'cx-mono' : ''} ${sidebarCollapsed ? 'cx-sidebar-collapsed' : ''} ${darkMode ? 'cx-dark' : ''}`}>
      {/* Sidebar overlay backdrop (visible on tablet when sidebar is open) */}
      {!sidebarCollapsed && (
        <div className="cx-sidebar-overlay" onClick={toggleSidebar} />
      )}

      {/* Sidebar (desktop) */}
      <aside className="cx-sidebar">
        <div className="cx-brand">
          <div className="cx-logo">C</div>
          <div className="cx-brand-text">
            <div className="cx-brand-title">COSMOSX</div>
            <div className="cx-brand-sub">Admin Suite</div>
          </div>
        </div>
        <AppNav pathname={pathname} items={navItems} />
        <div className="cx-sidebar-foot">
          {effectiveUserLabel ? <div className="cx-user">{effectiveUserLabel}</div> : <div className="cx-user">—</div>}
          <a className="cx-btn cx-btn-ghost" href="/login">
            Cerrar sesión
          </a>
        </div>
      </aside>

      {/* Main */}
      <div className="cx-main">
        {/* Topbar */}
        <header className="cx-topbar">
          {/* Desktop hamburger - collapses sidebar */}
          <button 
            className="cx-iconbtn cx-hamburger cx-hamburger-desktop" 
            type="button" 
            onClick={toggleSidebar} 
            aria-label={sidebarCollapsed ? "Expandir menú" : "Colapsar menú"}
            aria-expanded={!sidebarCollapsed}
          >
            <Icon d="M4 6h16M4 12h16M4 18h16" />
          </button>

          {/* Mobile hamburger - opens drawer */}
          <button 
            className="cx-iconbtn cx-hamburger cx-hamburger-mobile" 
            type="button" 
            onClick={() => setMobileOpen(true)} 
            aria-label="Abrir menú"
            aria-expanded={mobileOpen}
          >
            <Icon d="M4 6h16M4 12h16M4 18h16" />
          </button>

          <div className="cx-topbar-titles">
            <div className="cx-h1">{title}</div>
            {subtitle ? <div className="cx-h2">{subtitle}</div> : null}
          </div>

          <div className="cx-topbar-actions">{rightActions}</div>
        </header>

        {/* Mobile Drawer */}
        {mobileOpen && (
          <div className="cx-drawer" onClick={() => setMobileOpen(false)}>
            <div className="cx-drawer-panel" onClick={(e) => e.stopPropagation()}>
              <div className="cx-drawer-head">
                <div className="cx-brand">
                  <div className="cx-logo">C</div>
                  <div>
                    <div className="cx-brand-title">COSMOSX</div>
                    <div className="cx-brand-sub">Menú</div>
                  </div>
                </div>
                <button className="cx-iconbtn" type="button" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú">
                  <Icon d="M18 6L6 18M6 6l12 12" />
                </button>
              </div>

              <AppNav pathname={pathname} items={navItems} onNavigate={() => setMobileOpen(false)} />

               <div className="cx-drawer-foot">
                 {effectiveUserLabel ? <div className="cx-user">{effectiveUserLabel}</div> : null}
                <a className="cx-btn cx-btn-ghost" href="/login">
                  Cerrar sesión
                </a>
              </div>
            </div>
          </div>
        )}

        <main className="cx-content">{children}</main>
      </div>
    </div>
  );
}
