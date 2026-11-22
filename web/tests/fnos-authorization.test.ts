import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
interface CallbackWindow { TextEncoder: typeof TextEncoder; sessionStorage: Storage; location: Location; close: () => void }
interface CallbackDOM { window: CallbackWindow }
const { JSDOM } = createRequire(`${process.cwd()}/package.json`)('jsdom') as { JSDOM: new (html: string, options: { url: string; runScripts: 'dangerously'; beforeParse: (win: CallbackWindow) => void }) => CallbackDOM };
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_MESSAGE, AUTH_PENDING_KEY, AUTH_RETURN_KEY, AUTH_TTL, authorizationState, authorizeDirectory, consumeNasReturn, takeNasReturn } from '../src/fnos/authorization';
import { DIRECTORY_PICKER_PARAMS, NativePickerUnavailable, nativeDirectoryPicker } from '../src/fnos/native';
const state = '11111111-1111-4111-8111-111111111111';
const result = (status = 'success', extra = {}) => ({ type: AUTH_MESSAGE, appName: 'xiaoniubawang', method: 'pickUserFile', state, status, ...extra });
const pending = (extra = {}) => ({ state, createdAt: Date.now(), origin: location.origin, base: '', sourcePath: '/', returnUrl: `${location.origin}/#library`, mode: 'popup', ...extra });
beforeEach(() => { sessionStorage.clear(); history.replaceState(null, '', '/'); vi.spyOn(crypto, 'randomUUID').mockReturnValue(state); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete (window as unknown as { flutter_inappwebview?: unknown }).flutter_inappwebview; });
function send(source: Window, data = result(), origin = location.origin) { window.dispatchEvent(new MessageEvent('message', { source, origin, data })); }
describe('web directory authorization', () => {
  it('generates an unpredictable UUID on HTTP LAN origins without randomUUID', () => {
    const original = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
    try {
      const random = vi.spyOn(crypto, 'getRandomValues');
      const first = authorizationState();
      const second = authorizationState();
      expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(second).not.toBe(first);
      expect(random).toHaveBeenCalledTimes(2);
    } finally { if (original) Object.defineProperty(crypto, 'randomUUID', original); }
  });
  it('uses exact route/redirect, source and origin; accepts state once and never forwards raw paths', async () => {
    const popup = { close: vi.fn(), closed: false } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const flow = authorizeDirectory();
    const url = new URL(open.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/app-auth/pick-user-file');
    expect(url.searchParams.get('directory')).toBe('true');
    expect(url.searchParams.get('redirectUri')).toBe(`${location.origin}/fnos-callback.html`);
    send(window); send(popup, result(), 'https://wrong.example'); send(popup, result('success', { state: 'wrong' }));
    expect(sessionStorage.getItem(AUTH_PENDING_KEY)).not.toBeNull();
    send(popup, result('success', { path: ['/vol1/private/roms'] }));
    await expect(flow.result).resolves.toBe('success');
    expect(sessionStorage.getItem(AUTH_PENDING_KEY)).toBeNull();
    send(popup); expect(popup.close).toHaveBeenCalledTimes(1);
  });
  it('rejects cross-app context changes and expires after five minutes', async () => {
    vi.useFakeTimers();
    const popup = { close: vi.fn(), closed: false } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const flow = authorizeDirectory(); history.replaceState(null, '', '/app/xiaoniubawang/'); send(popup);
    expect(sessionStorage.getItem(AUTH_PENDING_KEY)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(AUTH_TTL);
    await expect(flow.result).resolves.toBe('expired');
  });
  it('handles popup blocked, close/cancel/error and explicit cancellation without navigation', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const blocked = authorizeDirectory(); expect(blocked.popupBlocked).toBe(true); blocked.cancel(); await expect(blocked.result).resolves.toBe('cancel');
    const popup = { close: vi.fn(), closed: false } as unknown as Window;
    vi.mocked(window.open).mockReturnValue(popup);
    const errored = authorizeDirectory(); send(popup, result('error')); await expect(errored.result).resolves.toBe('error');
  });
  it('consumes same-window return only once and checks origin, base, return URL and expiry', () => {
    sessionStorage.setItem(AUTH_PENDING_KEY, JSON.stringify(pending({ mode: 'self' })));
    sessionStorage.setItem(AUTH_RETURN_KEY, JSON.stringify(result()));
    expect(consumeNasReturn()).toBe(true); expect(consumeNasReturn()).toBe(true); expect(takeNasReturn()).toBe('success'); expect(consumeNasReturn()).toBe(false);
    sessionStorage.setItem(AUTH_PENDING_KEY, JSON.stringify(pending({ mode: 'self', createdAt: Date.now() - AUTH_TTL })));
    sessionStorage.setItem(AUTH_RETURN_KEY, JSON.stringify(result()));
    expect(consumeNasReturn()).toBe(true); expect(takeNasReturn()).toBe('expired');
    sessionStorage.setItem(AUTH_PENDING_KEY, JSON.stringify(pending({ mode: 'self', origin: 'https://wrong.example' })));
    sessionStorage.setItem(AUTH_RETURN_KEY, JSON.stringify(result())); expect(consumeNasReturn()).toBe(false);
  });
});
const html = readFileSync(`${process.cwd()}/public/fnos-callback.html`, 'utf8');
function callback(query: string, p: unknown = pending(), opener = true) {
  const post = vi.fn(); const close = vi.fn();
  const dom = new JSDOM(html, { url: `${location.origin}/fnos-callback.html?${query}`, runScripts: 'dangerously', beforeParse(win) {
    win.TextEncoder = TextEncoder;
    win.sessionStorage.setItem(AUTH_PENDING_KEY, JSON.stringify(p));
    Object.defineProperty(win, 'opener', { value: opener ? { closed: false, location: { origin: location.origin, pathname: '/' }, postMessage: post } : null });
    win.close = close;
  } });
  return { dom, post, close };
}
const query = (extra = {}) => new URLSearchParams({ state, appName: 'xiaoniubawang', method: 'pickUserFile', status: 'success', path: JSON.stringify(['/vol1/roms']), ...extra }).toString();
describe('actual static callback script', () => {
  it('removes sensitive query and sends no physical path, consumes popup state, rejects replay', () => {
    const { dom, post } = callback(query());
    expect(post).toHaveBeenCalledWith(result(), location.origin);
    expect(JSON.stringify(post.mock.calls)).not.toContain('/vol1/roms');
    expect(dom.window.location.search).toBe(''); expect(dom.window.sessionStorage.getItem(AUTH_PENDING_KEY)).toBeNull();
    const replay = callback(query(), null); expect(replay.post).not.toHaveBeenCalled();
    dom.window.close(); replay.dom.window.close();
  });
  it('rejects duplicate, malformed, traversal, wrong method, future/context and missing opener', () => {
    for (const value of [query() + '&state=wrong', query({ path: 'not-json' }), query({ path: '["/vol1/../secret"]' }), query({ method: 'pickFile' })]) {
      const test = callback(value); expect(test.post).not.toHaveBeenCalled(); test.dom.window.close();
    }
    for (const p of [pending({ createdAt: Date.now() + 10000 }), pending({ base: '/different' }), pending({ returnUrl: 'https://evil.example/' })]) {
      const test = callback(query(), p); expect(test.post).not.toHaveBeenCalled(); test.dom.window.close();
    }
    const test = callback(query(), pending(), false); expect(test.post).not.toHaveBeenCalled(); test.dom.window.close();
  });
  it('returns explicit cancellation/error/expiry and ignores any path for nonsuccess', () => {
    for (const status of ['cancel', 'error']) { const test = callback(query({ status, path: '' })); expect(test.post).toHaveBeenCalledWith(result(status), location.origin); test.dom.window.close(); }
    const test = callback(query(), pending({ createdAt: Date.now() - AUTH_TTL })); expect(test.post).toHaveBeenCalledWith(result('expired'), location.origin); test.dom.window.close();
  });
});
function native(call: ReturnType<typeof vi.fn>) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('FNOS/1.0 FNAppVer/1.2.0');
  (window as unknown as { flutter_inappwebview: unknown }).flutter_inappwebview = { callHandler: call };
}
const envelope = (value: unknown) => JSON.stringify({ result: JSON.stringify(value) });
describe('verified mobile native directory bridge', () => {
  it('calls supported appApi native picker with exact directory contract and discards physical path', async () => {
    const call = vi.fn().mockResolvedValueOnce(envelope({ appApi: 'v1.0' })).mockResolvedValueOnce(envelope({ code: 0, msg: '', data: ['/vol1/private/roms'] })); native(call);
    const flow = authorizeDirectory(); await expect(flow.result).resolves.toBe('success');
    expect(call.mock.calls).toEqual([['getAppMessage'], ['pickUserFile', JSON.stringify(DIRECTORY_PICKER_PARAMS)]]);
    expect(sessionStorage.getItem(AUTH_PENDING_KEY)).toBeNull();
  });
  it('requires actual bridge and supported version; refuses changed native bridge', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('FNAppVer/1.0'); expect(() => nativeDirectoryPicker()).toThrow(NativePickerUnavailable);
    const call = vi.fn().mockResolvedValue(envelope({ appApi: 'v0.9' })); native(call); await expect(nativeDirectoryPicker()!.result).rejects.toThrow(NativePickerUnavailable); expect(call).toHaveBeenCalledTimes(1);
    let resolve!: (value: unknown) => void; const waiting = vi.fn().mockReturnValue(new Promise((done) => { resolve = done; })); native(waiting);
    const flow = nativeDirectoryPicker()!; native(vi.fn()); resolve(envelope({ appApi: 'v1.0' })); await expect(flow.result).rejects.toThrow('会话已变化');
  });
  it('handles native cancel/error/malformed results and can cancel while waiting', async () => {
    for (const [data, outcome] of [[{ code: 0, data: [] }, 'cancel'], [{ code: 1, data: null }, 'error']] as const) {
      const call = vi.fn().mockResolvedValueOnce(envelope({ appApi: 'v1.0' })).mockResolvedValueOnce(envelope(data)); native(call); await expect(nativeDirectoryPicker()!.result).resolves.toBe(outcome);
    }
    native(vi.fn().mockResolvedValue('not-json')); await expect(nativeDirectoryPicker()!.result).rejects.toThrow();
    native(vi.fn().mockReturnValue(new Promise(() => {}))); const flow = nativeDirectoryPicker()!; flow.cancel(); await expect(flow.result).resolves.toBe('cancel');
  });
});
