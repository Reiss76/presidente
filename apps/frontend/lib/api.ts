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

  const method = (init?.method || 'GET').toUpperCase();
  const timeoutMs = Number(process.env.NEXT_PUBLIC_FETCH_TIMEOUT_MS || 12000);
  const retryCount = method === 'GET' ? 1 : 0;

  const doFetch = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        credentials: 'include',
        ...init,
        signal: init?.signal ?? controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let res: Response | null = null;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      res = await doFetch();
      break;
    } catch (networkErr: unknown) {
      lastErr = networkErr;
      if (attempt >= retryCount) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  if (!res) {
    const msg = lastErr instanceof Error ? lastErr.message : 'error de red';
    throw new Error(`Fetch falló: ${url} — ${msg}`);
  }

  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`Error ${res.status} en ${url}${body ? ` — ${body.slice(0, 300)}` : ''}`);
  }

  return res.json() as Promise<T>;
}
