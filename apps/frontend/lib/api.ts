/**
 * Returns the backend API base URL (without trailing slash).
 *
 * Resolution order (env only — no hardcoded fallback):
 *  1. NEXT_PUBLIC_API_URL
 *  2. NEXT_PUBLIC_API_BASE_URL
 *
 * Returns empty string when neither variable is set so callers
 * can show a visible error instead of silently fetching the wrong host.
 */
export function getApiBase(): string {
  const raw =
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    '';

  return raw.replace(/\/+$/, '');
}

/**
 * Thin fetch wrapper that:
 *  - builds an absolute URL from API_BASE + path
 *  - sends credentials:'include'
 *  - surfaces the real error message (endpoint, status, body) instead of
 *    a generic "Load failed" that Safari iOS shows for opaque failures.
 */
export async function fetchJson<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const base = getApiBase();
  if (!base) {
    throw new Error(
      'API_BASE no está configurado. Define NEXT_PUBLIC_API_URL o NEXT_PUBLIC_API_BASE_URL en las variables de entorno.',
    );
  }

  const url = `${base}${path}`;

  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include', ...init });
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : 'error de red';
    throw new Error(
      `Fetch falló: ${url} — ${msg}`,
    );
  }

  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch { /* ignore */ }
    throw new Error(
      `Error ${res.status} en ${url}${body ? ` — ${body.slice(0, 300)}` : ''}`,
    );
  }

  return res.json() as Promise<T>;
}
