import type { AuthOutcome } from './authorization';

interface NativeBridge { callHandler: (method: string, ...args: string[]) => Promise<unknown> }
type NativeWindow = Window & { flutter_inappwebview?: NativeBridge };
export const DIRECTORY_PICKER_PARAMS = { directory: true, multiple: false, creatable: false, sidebarGroup: ['myFiles'], title: '添加卡带目录', okText: '选择并授权' } as const;
export class NativePickerUnavailable extends Error { constructor() { super('当前移动客户端未提供目录选择授权，请在浏览器中打开本应用后重试。'); } }
/** Native calls do not use postMessage at all. Bind to the actual bridge captured
 * from this top-level native WebView, and reject bridge/window/context changes. */
export function nativeDirectoryPicker(): { result: Promise<AuthOutcome>; cancel: () => void } | null {
  if (!/FNAppVer\/[\d.]+/.test(navigator.userAgent)) return null;
  const host = window as NativeWindow;
  const bridge = host.flutter_inappwebview;
  if (window.parent !== window || !bridge || typeof bridge.callHandler !== 'function') throw new NativePickerUnavailable();
  const origin = location.origin;
  const pathname = location.pathname;
  const call = bridge.callHandler.bind(bridge);
  let cancelled = false;
  let timedOut = false;
  let abort!: () => void;
  let timer = 0;
  const stop = new Promise<never>((_, reject) => { abort = () => { cancelled = true; reject(new Error('目录授权已取消。')); }; timer = window.setTimeout(() => { timedOut = true; reject(new Error('目录授权已超时，请重试。')); }, 300000); });
  const current = () => {
    if (cancelled || timedOut || host.flutter_inappwebview !== bridge || location.origin !== origin || location.pathname !== pathname || window.parent !== window) throw new Error('目录授权窗口或会话已变化，请重新选择。');
  };
  const invoke = async (method: string, args?: string): Promise<unknown> => {
    current();
    const raw = await call(method, ...(args === undefined ? [] : [args]));
    current();
    if (typeof raw !== 'string' || raw.length > 32768) throw new Error('移动客户端返回的目录授权数据无效。');
    const envelope: unknown = JSON.parse(raw);
    if (!envelope || typeof envelope !== 'object' || typeof (envelope as { result?: unknown }).result !== 'string') throw new Error('移动客户端返回的目录授权数据无效。');
    return JSON.parse((envelope as { result: string }).result);
  };
  const work = (async (): Promise<AuthOutcome> => {
    let metadataTimer = 0;
    let metadata: unknown;
    try { metadata = await Promise.race([invoke('getAppMessage'), new Promise<never>((_, reject) => { metadataTimer = window.setTimeout(() => reject(new NativePickerUnavailable()), 5000); })]); }
    finally { window.clearTimeout(metadataTimer); }
    const apiVersion = metadata && typeof metadata === 'object' ? (metadata as { appApi?: unknown }).appApi : null;
    if (typeof apiVersion !== 'string' || !/^v?\d+(\.\d+)*$/.test(apiVersion) || Number(apiVersion.replace(/^v/, '').split('.')[0]) < 1) throw new NativePickerUnavailable();
    const response = await invoke('pickUserFile', JSON.stringify(DIRECTORY_PICKER_PARAMS));
    if (!response || typeof response !== 'object') return 'cancel';
    const r = response as { code?: unknown; msg?: unknown; data?: unknown };
    if (r.code !== 0) return 'error';
    if (Array.isArray(r.data) && r.data.length === 0) return 'cancel';
    if (!Array.isArray(r.data) || r.data.length !== 1 || typeof r.data[0] !== 'string' || !/^\/vol[1-9]\d*\//.test(r.data[0]) || new TextEncoder().encode(r.data[0]).length > 4096 || /[\\\p{Cc}]/u.test(r.data[0]) || r.data[0].split('/').slice(1).some((part) => !part || part === '.' || part === '..')) throw new Error('移动客户端返回的目录选择结果无效。');
    // Selected physical path is validated then discarded. Refresh Roots, never submit it to NAS APIs.
    return 'success';
  })();
  const result = Promise.race([work, stop]).catch((error: unknown) => { if (timedOut) return 'expired' as const; if (cancelled) return 'cancel' as const; throw error; }).finally(() => window.clearTimeout(timer));
  return { result, cancel: abort };
}
