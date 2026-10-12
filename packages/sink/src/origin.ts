/**
 * Checks a request's Origin header against an allowlist. Entries are exact
 * origins (`http://localhost:5173`) or a host with a wildcard port
 * (`http://localhost:*`). Requests without an Origin are rejected.
 */
export function isAllowedOrigin(origin: string | undefined, allowlist: readonly string[]): boolean {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  return allowlist.some((entry) => {
    if (!entry.endsWith(':*')) return entry === origin;
    const base = entry.slice(0, -2);
    return `${url.protocol}//${url.hostname}` === base;
  });
}

export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  'http://localhost:*',
  'http://127.0.0.1:*',
  'http://[::1]:*',
];
