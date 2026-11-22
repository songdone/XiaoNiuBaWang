import { GATEWAY_PREFIX } from '../types';

export function gatewayBase(pathname = window.location.pathname): string {
  const prefix = GATEWAY_PREFIX;
  return pathname === prefix || pathname.startsWith(`${prefix}/`) ? prefix : '';
}

export function appUrl(path: string): string {
  return `${gatewayBase()}/${path.replace(/^\/+/, '')}`;
}

/** Resolve server paths while keeping requests within the current FNOS app gateway. */
export function sameOriginUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, `${window.location.origin}${appUrl('')}`);
    if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol)) return null;
    const base = gatewayBase();
    const pathname = base && !url.pathname.startsWith(`${base}/`) ? `${base}${url.pathname}` : url.pathname;
    return `${pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

let csrfHeader = '';
let csrfToken = '';
export function configureCsrf(header: unknown, token: unknown) {
  if (typeof header === 'string' && /^[A-Za-z0-9-]+$/.test(header) && typeof token === 'string') {
    csrfHeader = header;
    csrfToken = token;
  }
}
export function apiHeaders(initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  if (csrfHeader && csrfToken) headers.set(csrfHeader, csrfToken);
  const marker = import.meta.env.DEV ? import.meta.env.VITE_TEST_USER as string | undefined : undefined;
  if (marker) headers.set('X-XNBW-Test-User', marker);
  return headers;
}
