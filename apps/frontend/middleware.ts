import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = new Set([
  '/login',
  '/request-access',
  '/change-password',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
]);

const isPublicPath = (pathname: string) => {
  if (pathname.startsWith('/_next')) return true;
  if (pathname.startsWith('/api')) return true;
  if (pathname.startsWith('/auth')) return true;
  if (pathname.startsWith('/debug')) return true;
  for (const path of PUBLIC_PATHS) {
    if (pathname === path || pathname.startsWith(path + '/')) return true;
  }
  return false;
};

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const hasSession = req.cookies.get('cosmosx_session');

  if (!hasSession) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/|api/|auth/|debug/|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)'],
};
