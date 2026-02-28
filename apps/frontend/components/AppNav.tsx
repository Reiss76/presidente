'use client';

import React from 'react';

export type NavItem = {
  label: string;
  href: string;
  icon?: React.ReactNode;
  visible?: boolean;
};

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export default function AppNav({
  pathname,
  items,
  onNavigate,
  compact,
}: {
  pathname: string;
  items: NavItem[];
  onNavigate?: () => void;
  compact?: boolean;
}) {
  return (
    <nav className={`cx-nav ${compact ? 'cx-nav-compact' : ''}`}>
      {items
        .filter((it) => it.visible !== false)
        .map((it) => {
        const active = isActive(pathname, it.href);
        return (
          <a
            key={it.href}
            href={it.href}
            onClick={() => onNavigate?.()}
            className={`cx-nav-item ${active ? 'is-active' : ''}`}
            title={compact ? it.label : undefined}
            aria-label={compact ? it.label : undefined}
          >
            <span className="cx-nav-ic">{it.icon}</span>
            <span className="cx-nav-label">{it.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
