import { appUrl, gatewayBase } from '../api/urls';
import { nativeDirectoryPicker } from './native';

export const AUTH_PENDING_KEY = 'xnbw-directory-auth';
export const AUTH_RETURN_KEY = 'xnbw-directory-auth-return';
export const AUTH_TTL = 5 * 60 * 1000;
export const AUTH_MESSAGE = 'xnbw-directory-auth-result';
export type AuthOutcome = 'success' | 'cancel' | 'error' | 'expired';
interface PendingAuth { state: string; createdAt: number; origin: string; base: string; sourcePath: string; returnUrl: string; mode: 'popup' | 'self' }
interface AuthResult { type: typeof AUTH_MESSAGE; state: string; appName: 'xiaoniubawang'; method: 'pickUserFile'; status: AuthOutcome }
export function authorizationState(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Web Crypto random values remain available on HTTP LAN origins.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const isState = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function read(key: string): unknown { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; } }
function validPending(value: unknown): value is PendingAuth {
  if (!value || typeof value !== 'object') return false;
  const p = value as PendingAuth;
  try {
    const back = new URL(p.returnUrl);
    return isState(p.state) && Number.isFinite(p.createdAt) && p.createdAt <= Date.now() && p.origin === location.origin && p.base === gatewayBase() && [`${p.base}/`, `${p.base}/index.html`, p.base || '/'].includes(p.sourcePath) && back.origin === p.origin && back.pathname === `${p.base}/` && !back.search && (p.mode === 'popup' || p.mode === 'self');
  } catch { return false; }
}
function validResult(value: unknown, state: string): value is AuthResult {
  if (!value || typeof value !== 'object') return false;
  const r = value as AuthResult;
  return r.type === AUTH_MESSAGE && r.state === state && r.appName === 'xiaoniubawang' && r.method === 'pickUserFile' && ['success', 'cancel', 'error', 'expired'].includes(r.status);
}
let returned: AuthOutcome | null = null;
/** Called once by App before opening the restored NAS dialog. No filesystem paths survive the callback. */
export function consumeNasReturn(): boolean {
  // React StrictMode may invoke App's initializer twice; the same in-memory
  // outcome stays available only until NasDialog takes it, never across reloads.
  if (returned !== null) return true;
  const result = read(AUTH_RETURN_KEY);
  const pending = read(AUTH_PENDING_KEY);
  try { sessionStorage.removeItem(AUTH_RETURN_KEY); } catch { return false; }
  if (!validPending(pending) || pending.mode !== 'self' || !validResult(result, pending.state)) return false;
  try { sessionStorage.removeItem(AUTH_PENDING_KEY); } catch { return false; }
  returned = Date.now() - pending.createdAt >= AUTH_TTL ? 'expired' : result.status;
  return true;
}
export function takeNasReturn(): AuthOutcome | null { const value = returned; returned = null; return value; }

export interface DirectoryAuthorization {
  popupBlocked: boolean;
  result: Promise<AuthOutcome>;
  cancel: () => void;
  continueInSameWindow: () => void;
}
/** Use the verified web route, never the SDK's wildcard host handshake or an unverified mobile bridge. */
export function authorizeDirectory(): DirectoryAuthorization {
  const native = nativeDirectoryPicker();
  if (native) return { ...native, popupBlocked: false, continueInSameWindow: () => {} };
  const state = authorizationState();
  const pending: PendingAuth = { state, createdAt: Date.now(), origin: location.origin, base: gatewayBase(), sourcePath: location.pathname, returnUrl: `${location.origin}${appUrl('')}${location.hash}`, mode: 'popup' };
  // Storage is essential for a same-window return and popup context validation. Fail closed if unavailable.
  sessionStorage.setItem(AUTH_PENDING_KEY, JSON.stringify(pending));
  sessionStorage.removeItem(AUTH_RETURN_KEY);
  const url = new URL('/app-auth/pick-user-file', location.origin);
  url.search = new URLSearchParams({ appName: 'xiaoniubawang', directory: 'true', sidebarGroup: 'myFiles', redirectUri: `${location.origin}${appUrl('fnos-callback.html')}`, state }).toString();
  let popup: Window | null = null;
  let settled = false;
  let resolve!: (value: AuthOutcome) => void;
  const result = new Promise<AuthOutcome>((done) => { resolve = done; });
  let expiry = 0;
  let closed = 0;
  const cleanup = () => { window.removeEventListener('message', receive); window.clearTimeout(expiry); window.clearInterval(closed); };
  const finish = (outcome: AuthOutcome) => {
    if (settled) return;
    settled = true; cleanup();
    const stored = read(AUTH_PENDING_KEY);
    if (validPending(stored) && stored.state === state) sessionStorage.removeItem(AUTH_PENDING_KEY);
    try { popup?.close(); } catch { /* The callback can also close itself. */ }
    resolve(outcome);
  };
  const receive = (event: MessageEvent) => {
    if (!popup || event.source !== popup || event.origin !== pending.origin || !validResult(event.data, state)) return;
    const stored = read(AUTH_PENDING_KEY);
    if (!validPending(stored) || stored.state !== state || stored.mode !== 'popup' || location.pathname !== pending.sourcePath) return;
    finish(Date.now() - pending.createdAt >= AUTH_TTL ? 'expired' : event.data.status);
  };
  window.addEventListener('message', receive);
  try { popup = window.open(url.href, '_blank', 'popup,width=760,height=640'); } catch { /* Offer an explicit same-window alternative. */ }
  expiry = window.setTimeout(() => finish('expired'), AUTH_TTL);
  if (popup) closed = window.setInterval(() => { if (popup?.closed) finish('cancel'); }, 500);
  return {
    popupBlocked: !popup, result, cancel: () => finish('cancel'),
    continueInSameWindow: () => {
      if (settled) return;
      if (Date.now() - pending.createdAt >= AUTH_TTL) { finish('expired'); return; }
      sessionStorage.setItem(AUTH_PENDING_KEY, JSON.stringify({ ...pending, mode: 'self' }));
      cleanup(); location.assign(url.href);
    },
  };
}
