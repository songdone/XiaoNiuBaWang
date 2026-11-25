// Controlled fetch + mocked emulator boundary. These component tests are NOT WASM end-to-end gameplay tests.
import { setTimeout as flushIO } from 'node:timers/promises';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerPage } from '../src/pages/PlayerPage';
import { DEFAULT_SETTINGS, type SaveRecord } from '../src/types';
import { normalizeGame } from '../src/api/client';
import { navigate, useRoute } from '../src/hooks/useRoute';
import type { EmulatorAdapter } from '../src/emulator/adapter';

const boundary = vi.hoisted(() => ({ adapter: null as EmulatorAdapter | null }));
vi.mock('../src/emulator/adapter', async (original) => ({
  ...await original<typeof import('../src/emulator/adapter')>(),
  createAdapter: vi.fn(async () => ({ status: 'ready', adapter: boundary.adapter })),
}));
const game = normalizeGame({ id: 'fixture', title: '测试卡带', sha256: 'rom-hash', filename: 'fixture.nes' })!;
const settings = { ...DEFAULT_SETTINGS, showTouchControls: false };
type Call = { path: string; method: string; headers: Headers; bytes: Uint8Array; slot: number; kind: string };
let calls: Call[];
let records: SaveRecord[];
let ram: Uint8Array;
let state: Uint8Array;
let write: (call: Call) => Promise<Response>;
let blobs: Blob[];
let downloads: string[];
let activeUploads: number;
let maximumUploads: number;
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
function record(slot: number, kind: 'state' | 'sram' = 'state', etag = '"v1"'): SaveRecord {
  return { id: `${kind}-${slot}`, gameId: game.id, kind, slot, core: 'fceumm', coreVersion: 'test-v1', romSha256: game.sha256, etag, createdAt: '2026-11-22T00:00:00Z', url: `/api/saves/${kind}-${slot}`, size: 3 };
}
async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer)); reader.readAsArrayBuffer(blob); });
}
function storedSnapshotBytes(item: { bytes?: number[]; bytesB64?: string }): number[] {
  if (typeof item.bytesB64 === 'string') return Array.from(atob(item.bytesB64), (ch) => ch.charCodeAt(0));
  return item.bytes ?? [];
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function Harness({ playerSettings = settings, onOpenInputSettings }: { playerSettings?: typeof settings; onOpenInputSettings?: () => void }) {
  const route = useRoute();
  return <><button onClick={() => void navigate('library')}>App 卡带库</button><button onClick={() => void navigate('game', game.id)}>App 详情</button><a href="#/">库链接</a><output data-testid="route">{route.page}</output>{route.page === 'player' && <PlayerPage id={game.id} health={null} settings={playerSettings} onPlayed={() => {}} onOpenInputSettings={onOpenInputSettings}/>}</>;
}
async function setup(props: Parameters<typeof Harness>[0] = {}) { render(<Harness {...props}/>); await screen.findByRole('button', { name: '开始运行卡带' }); }
const canvas = () => screen.getByLabelText('测试卡带 运行画面') as HTMLCanvasElement;
const machine = () => canvas().closest('.player-machine') as HTMLDivElement;
async function start() {
  fireEvent.click(screen.getByRole('button', { name: '开始运行卡带' }));
  await screen.findByRole('button', { name: '暂停运行' });
  await waitFor(() => expect(document.activeElement).toBe(canvas()));
}
async function resume() {
  fireEvent.click(screen.getByRole('button', { name: '继续运行卡带' }));
  await screen.findByRole('button', { name: '暂停运行' });
  await waitFor(() => expect(document.activeElement).toBe(canvas()));
}
const uploads = () => calls.filter((call) => ['POST', 'PUT'].includes(call.method) && call.path.startsWith('/api/saves'));

// Model the browser fullscreen boundary, not a canvas-only or WASM implementation.
function mockFullscreen(mode: 'native' | 'unsupported' | 'rejected' = 'native') {
  let element: Element | null = null;
  const requested: HTMLElement[] = [];
  const change = (next: Element | null) => { element = next; document.dispatchEvent(new Event('fullscreenchange')); };
  const request = vi.fn(async function(this: HTMLElement) {
    requested.push(this);
    if (mode === 'rejected') throw new DOMException('Fullscreen denied', 'NotAllowedError');
    change(this);
  });
  const exit = vi.fn(async () => change(null));
  const define = (target: object, key: string, descriptor: PropertyDescriptor) => {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, ...descriptor });
    fullscreenCleanup.push(() => { if (previous) Object.defineProperty(target, key, previous); else Reflect.deleteProperty(target, key); });
  };
  define(document, 'fullscreenEnabled', { value: mode !== 'unsupported' });
  define(document, 'fullscreenElement', { get: () => element });
  define(document, 'exitFullscreen', { value: exit });
  define(HTMLElement.prototype, 'requestFullscreen', { value: request });
  return { request, requested, exit, change };
}
let fullscreenCleanup: (() => void)[] = [];

beforeEach(() => {
  window.history.replaceState(null, '', '#/play/fixture');
  sessionStorage.clear(); calls = []; records = []; ram = new Uint8Array([1, 2]); state = new Uint8Array([7, 8, 9]); blobs = []; downloads = []; activeUploads = 0; maximumUploads = 0;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:fixture'; }) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { downloads.push(this.download); });
  boundary.adapter = {
    name: 'FCEUmm', version: 'test-v1', capabilities: { saveRAM: true, saveState: true, audio: true, keyboard: true },
    load: vi.fn(async () => {}), start: vi.fn(), pause: vi.fn(), reset: vi.fn(), destroy: vi.fn(), setButton: vi.fn(), setKeyboardKey: vi.fn(), setKeyboardDevice: vi.fn(), releaseAll: vi.fn(), setVolume: vi.fn(),
    saveState: vi.fn(() => state), getSaveRAM: vi.fn(() => ram.slice()), loadState: vi.fn(), loadSaveRAM: vi.fn(),
  };
  write = async (call) => { const saved = record(call.slot, call.kind as 'state' | 'sram', `"v${uploads().length}"`); records = [...records.filter((item) => item.id !== saved.id), saved]; return json(saved); };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url, window.location.origin).pathname;
    const method = init.method || 'GET';
    const call: Call = { path, method, headers: new Headers(init.headers), bytes: new Uint8Array(), slot: 0, kind: '' };
    if (init.body instanceof FormData) {
      call.slot = Number(init.body.get('slot')); call.kind = String(init.body.get('kind')); call.bytes = await blobBytes(init.body.get('file') as Blob);
    } else if (init.body instanceof Blob) {
      call.bytes = await blobBytes(init.body); const existing = records.find((item) => path.endsWith(`/${item.id}`)); call.slot = existing?.slot ?? 0; call.kind = existing?.kind ?? 'state';
    }
    calls.push(call);
    if (method !== 'GET' && path.startsWith('/api/saves')) { activeUploads++; maximumUploads = Math.max(maximumUploads, activeUploads); try { return await write(call); } finally { activeUploads--; } }
    if (path === '/api/games/fixture') return json(game);
    if (path === '/api/games/fixture/launch') return json({ romUrl: '/roms/fixture.nes' });
    if (path === '/roms/fixture.nes') return new Response(new Uint8Array([78, 69, 83, 26]));
    if (path === '/api/saves') return json(records);
    if (path.startsWith('/api/saves/')) return new Response(new Uint8Array([4, 5, 6]));
    throw new Error(`Unhandled fixture call ${method} ${path}`);
  }));
});
afterEach(() => { cleanup(); for (const restore of fullscreenCleanup.reverse()) restore(); fullscreenCleanup = []; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Player components — mocked emulator + real API client, not WASM E2E', () => {
  it('saves all three slots 1–3 and downloads a normal current snapshot', async () => {
    await setup();
    const select = screen.getByLabelText('即时存档槽位');
    for (const slot of [1, 2, 3]) {
      fireEvent.change(select, { target: { value: String(slot) } });
      fireEvent.click(screen.getByRole('button', { name: '保存进度' }));
      await screen.findByText(`已保存到槽位 ${slot}。`);
    }
    expect(uploads().map((call) => call.slot)).toEqual([1, 2, 3]);
    expect(uploads().map((call) => Array.from(call.bytes))).toEqual([[7, 8, 9], [7, 8, 9], [7, 8, 9]]);
    fireEvent.click(screen.getByRole('button', { name: '下载当前即时存档' }));
    await waitFor(() => expect(downloads).toEqual(['测试卡带-state-3.state']));
    expect(Array.from(await blobBytes(blobs[0]))).toEqual([7, 8, 9]);
    expect(sessionStorage.length).toBe(0);
  });
  it('uploads only changed SRAM every 30s, skips unchanged bytes and never overlaps', async () => {
    await setup(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '开始运行卡带' })); });
    expect(screen.getByRole('button', { name: '暂停运行' })).toBeDefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); await flushIO(0); });
    expect(uploads()).toHaveLength(0);
    ram = new Uint8Array([2, 3]); const pending = deferred<Response>(); write = () => pending.promise;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); await flushIO(0); });
    expect(boundary.adapter!.getSaveRAM).toHaveBeenCalledTimes(3);
    expect(sessionStorage.getItem('xnbw:pending:fixture')).not.toBeNull();
    expect(uploads()).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(uploads()).toHaveLength(1); expect(maximumUploads).toBe(1);
    await act(async () => { pending.resolve(json(record(0, 'sram'))); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); await flushIO(0); });
    expect(uploads()).toHaveLength(1);
    write = async () => json(record(0, 'sram', '"v2"')); ram = new Uint8Array([9, 3]);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); await flushIO(0); });
    expect(uploads()).toHaveLength(2); expect(Array.from(uploads()[1].bytes)).toEqual([9, 3]); expect(maximumUploads).toBe(1);
  });
  it.each([409, 412])('preserves local bytes on %i; keep both really downloads without overwriting server', async (status) => {
    records = [record(1)]; write = async () => json({ error: { code: 'save_conflict' } }, status);
    await setup(); fireEvent.click(screen.getByRole('button', { name: '保存进度' }));
    await screen.findByText('存档发生冲突，本地进度已保留');
    expect(uploads()[0].headers.get('If-Match')).toBe('"v1"');
    state[0] = 99;
    fireEvent.click(screen.getByRole('button', { name: '处理服务器冲突' }));
    fireEvent.click(screen.getByRole('button', { name: '保留两份，下载本地' }));
    await waitFor(() => expect(screen.queryByText('存档发生冲突，本地进度已保留')).toBeNull());
    expect(Array.from(await blobBytes(blobs[0]))).toEqual([7, 8, 9]);
    expect(uploads()).toHaveLength(1); expect(records[0].etag).toBe('"v1"'); expect(sessionStorage.length).toBe(0);
  });
  it('explicit overwrite refreshes server ETag and keeps bytes if that version races again', async () => {
    records = [record(1)]; write = async () => json({ error: '存档冲突' }, 412);
    await setup(); fireEvent.click(screen.getByRole('button', { name: '保存进度' })); await screen.findByText('存档发生冲突，本地进度已保留');
    records = [record(1, 'state', '"remote-v2"')];
    fireEvent.click(screen.getByRole('button', { name: '处理服务器冲突' })); fireEvent.click(screen.getByRole('button', { name: '用本地进度更新服务器' }));
    await waitFor(() => expect(uploads()).toHaveLength(2));
    expect(uploads()[1].headers.get('If-Match')).toBe('"remote-v2"');
    await waitFor(() => expect(screen.getByRole('button', { name: '处理服务器冲突' })).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '下载本地快照' }));
    expect(Array.from(await blobBytes(blobs[0]))).toEqual([7, 8, 9]);
  });
  it('serializes loading/reset with saving and releases physical keys for both', async () => {
    records = [record(1)]; await setup(); await start();
    fireEvent.keyDown(canvas(), { code: 'KeyX', key: 'x' });
    fireEvent.click(screen.getByRole('button', { name: '读取进度' }));
    await screen.findByText('已读取槽位 1，点击继续运行。');
    expect(boundary.adapter!.loadState).toHaveBeenCalledWith(new Uint8Array([4, 5, 6])); expect(boundary.adapter!.setButton).toHaveBeenCalledWith(1, 'a', false);
    await resume();
    fireEvent.keyDown(canvas(), { code: 'ArrowUp', key: 'ArrowUp' });
    fireEvent.click(screen.getByRole('button', { name: '重置卡带' })); fireEvent.click(screen.getByRole('button', { name: '重新启动' }));
    await screen.findByText('卡带已重新启动，点击继续运行。'); expect(boundary.adapter!.reset).toHaveBeenCalledTimes(1);
    expect(boundary.adapter!.setButton).toHaveBeenCalledWith(1, 'up', false);
    const pending = deferred<Response>(); write = () => pending.promise;
    fireEvent.click(screen.getByRole('button', { name: '保存进度' }));
    expect((screen.getByRole('button', { name: '读取进度' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '重置卡带' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { pending.resolve(json(record(1))); });
  });
  it.each(['App 卡带库', '卡带详情', 'hash'])('blocks %s navigation on pending failure until download-and-leave', async (source) => {
    write = async () => json({ error: '服务暂不可用' }, 503); await setup();
    fireEvent.click(screen.getByRole('button', { name: '保存进度' })); await screen.findByText('有一份尚未上传的本地快照');
    if (source === 'hash') { await act(async () => { window.location.hash = '#/'; window.dispatchEvent(new HashChangeEvent('hashchange')); }); }
    else fireEvent.click(screen.getByRole('button', { name: source }));
    await screen.findByRole('dialog', { name: '离开前保留进度' });
    expect(screen.getByTestId('route').textContent).toBe('player'); expect(window.location.hash).toBe('#/play/fixture'); expect(boundary.adapter!.destroy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '下载快照并离开' }));
    await waitFor(() => expect(screen.getByTestId('route').textContent).toBe(source === '卡带详情' ? 'game' : 'library'));
    expect(Array.from(await blobBytes(blobs[0]))).toEqual([7, 8, 9]); expect(boundary.adapter!.destroy).toHaveBeenCalledTimes(1);
  });
  it('requires a second explicit confirmation for discard and supports cancel', async () => {
    write = async () => json({ error: '网络错误' }, 503); await setup(); fireEvent.click(screen.getByRole('button', { name: '保存进度' })); await screen.findByText('有一份尚未上传的本地快照');
    fireEvent.click(screen.getByRole('button', { name: 'App 卡带库' })); await screen.findByRole('dialog', { name: '离开前保留进度' });
    fireEvent.click(screen.getByRole('button', { name: '丢弃并离开…' })); expect(screen.getByTestId('route').textContent).toBe('player');
    fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(sessionStorage.length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '丢弃并离开…' })); fireEvent.click(screen.getByRole('button', { name: '确认丢弃并离开' }));
    await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('library')); expect(sessionStorage.length).toBe(0); expect(downloads).toHaveLength(0);
  });
  it('failed snapshot download never clears pending or approves exit; retry then leaves safely', async () => {
    write = async () => json({ error: '服务器离线' }, 503); await setup();
    fireEvent.click(screen.getByRole('button', { name: '保存进度' })); await screen.findByText('有一份尚未上传的本地快照');
    fireEvent.click(screen.getByRole('button', { name: 'App 卡带库' })); await screen.findByRole('dialog', { name: '离开前保留进度' });
    vi.mocked(URL.createObjectURL).mockImplementationOnce(() => { throw new Error('下载失败'); });
    fireEvent.click(screen.getByRole('button', { name: '下载快照并离开' }));
    expect(screen.getByTestId('route').textContent).toBe('player'); expect(sessionStorage.length).toBe(1);
    write = async () => json(record(1)); fireEvent.click(screen.getByRole('button', { name: '保存 / 重试后离开' }));
    await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('library')); expect(sessionStorage.length).toBe(0); expect(downloads).toHaveLength(0);
  });
  it('exit preserves both earlier failed state bytes and the latest changed SRAM', async () => {
    write = async () => json({ error: '服务器离线' }, 503); await setup();
    fireEvent.click(screen.getByRole('button', { name: '保存进度' })); await screen.findByText('有一份尚未上传的本地快照');
    ram = new Uint8Array([66, 77]); state[0] = 99;
    fireEvent.click(screen.getByRole('button', { name: 'App 卡带库' })); await screen.findByRole('dialog', { name: '离开前保留进度' });
    const stored = JSON.parse(sessionStorage.getItem('xnbw:pending:fixture')!);
    expect(stored.map(storedSnapshotBytes)).toEqual([[7, 8, 9], [66, 77]]);
    fireEvent.click(screen.getByRole('button', { name: '下载快照并离开' })); await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('library'));
    expect(downloads).toEqual(['测试卡带-state-1.state', '测试卡带-sram-0.sav']); expect(Array.from(await blobBytes(blobs[0]))).toEqual([7, 8, 9]); expect(Array.from(await blobBytes(blobs[1]))).toEqual([66, 77]);
  });
  it('storage quota failure explicitly warns without losing in-memory bytes', async () => {
    const storage = vi.spyOn(Object.getPrototypeOf(sessionStorage), 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    write = async () => json({ error: '服务器离线' }, 503); await setup(); fireEvent.click(screen.getByRole('button', { name: '保存进度' }));
    await waitFor(() => expect(storage).toHaveBeenCalled());
    await screen.findByText('浏览器未能持久保留本地快照。刷新或关闭前请下载，当前内存中的快照仍在。');
    fireEvent.click(screen.getByRole('button', { name: '下载本地快照' })); expect(Array.from(await blobBytes(blobs[0]))).toEqual([7, 8, 9]);
  });
  it('beforeunload retains changed SRAM synchronously and never starts an upload', async () => {
    await setup(); await start(); ram = new Uint8Array([88, 99]);
    const event = new Event('beforeunload', { cancelable: true }); fireEvent(window, event);
    expect(event.defaultPrevented).toBe(true); expect(uploads()).toHaveLength(0);
    expect(storedSnapshotBytes(JSON.parse(sessionStorage.getItem('xnbw:pending:fixture')!)[0])).toEqual([88, 99]);
  });
  it('flushes changed SRAM before successful internal exit', async () => {
    await setup(); await start(); ram = new Uint8Array([11, 22]);
    fireEvent.click(screen.getByRole('button', { name: 'App 卡带库' }));
    await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('library'));
    expect(uploads()).toHaveLength(1); expect(uploads()[0].kind).toBe('sram'); expect(Array.from(uploads()[0].bytes)).toEqual([11, 22]); expect(boundary.adapter!.pause).toHaveBeenCalled();
  });
  it('bounded exit does not unlock a hanging upload; pending survives reload and beforeunload uploads nothing', async () => {
    await setup(); await start(); ram = new Uint8Array([3, 4]); const pending = deferred<Response>(); write = () => pending.promise;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    fireEvent.click(screen.getByRole('button', { name: 'App 卡带库' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.getByRole('dialog', { name: '离开前保留进度' })).toBeDefined();
    expect((screen.getByRole('button', { name: '下载快照并离开' }) as HTMLButtonElement).disabled).toBe(true); expect(maximumUploads).toBe(1);
    const count = uploads().length; const event = new Event('beforeunload', { cancelable: true }); fireEvent(window, event);
    expect(event.defaultPrevented).toBe(true); expect(uploads()).toHaveLength(count);
    const retained = JSON.parse(sessionStorage.getItem('xnbw:pending:fixture')!); expect(storedSnapshotBytes(retained[0])).toEqual([3, 4]);
    fireEvent.click(screen.getByRole('button', { name: '留在播放器' }));
    await act(async () => { pending.resolve(json({ error: '失败' }, 503)); }); vi.useRealTimers();
    cleanup(); await setup(); await screen.findByText('有一份尚未上传的本地快照');
    fireEvent.click(screen.getByRole('button', { name: '下载本地快照' })); expect(Array.from(await blobBytes(blobs[0]))).toEqual([3, 4]);
  });
});

describe('Player presentation and input lifecycle — mocked browser/emulator boundaries, not WASM E2E', () => {
  it('requests native fullscreen for the entire machine, retaining canvas, touch controls, tools and key hints', async () => {
    const fullscreen = mockFullscreen();
    await setup({ playerSettings: { ...settings, showTouchControls: true } }); await start();
    const target = machine();
    fireEvent.keyDown(canvas(), { code: 'KeyX', key: 'x' });
    expect(boundary.adapter!.setButton).toHaveBeenCalledWith(1, 'a', true);
    fireEvent.click(screen.getByRole('button', { name: '全屏游玩' }));
    await waitFor(() => expect(target.dataset.presentation).toBe('fullscreen'));
    expect(fullscreen.requested).toEqual([target]); expect(document.fullscreenElement).toBe(target);
    expect(target.contains(canvas())).toBe(true);
    expect(within(target).getByRole('button', { name: 'A 按键' })).toBeDefined();
    expect(within(target).getByRole('button', { name: '暂停运行' })).toBeDefined();
    expect(within(target).getByRole('button', { name: '静音' })).toBeDefined();
    expect(within(target).getByLabelText('播放器音量')).toBeDefined();
    expect(within(target).getByRole('region', { name: '当前游戏键位' })).toBeDefined();
    expect(within(target).getByRole('button', { name: '退出全屏或大屏' })).toBeDefined();
    expect(boundary.adapter!.setButton).toHaveBeenCalledWith(1, 'a', false);
    expect(document.body.classList.contains('player-presentation-open')).toBe(true);
    fireEvent.keyDown(canvas(), { code: 'ArrowUp', key: 'ArrowUp' });
    fireEvent.click(screen.getByRole('button', { name: '退出全屏或大屏' }));
    await waitFor(() => expect(target.dataset.presentation).toBe('window'));
    expect(fullscreen.exit).toHaveBeenCalledTimes(1); expect(document.fullscreenElement).toBeNull();
    expect(boundary.adapter!.setButton).toHaveBeenCalledWith(1, 'up', false);
    expect(document.body.classList.contains('player-presentation-open')).toBe(false);
    expect(boundary.adapter!.saveState).not.toHaveBeenCalled(); expect(boundary.adapter!.destroy).not.toHaveBeenCalled();
  });

  it.each(['unsupported', 'rejected'] as const)('uses actual page theater when fullscreen is %s, and exit releases held inputs', async (mode) => {
    const fullscreen = mockFullscreen(mode);
    await setup({ playerSettings: { ...settings, showTouchControls: true } }); await start();
    fireEvent.click(screen.getByRole('button', { name: '全屏游玩' }));
    await waitFor(() => expect(machine().dataset.presentation).toBe('theater'));
    expect(document.fullscreenElement).toBeNull();
    expect(fullscreen.request).toHaveBeenCalledTimes(mode === 'rejected' ? 1 : 0);
    if (mode === 'rejected') expect(screen.getByText('当前环境不允许系统全屏，已切换页内大屏。')).toBeDefined();
    const touch = screen.getByRole('button', { name: 'A 按键' });
    act(() => touch.focus()); fireEvent.keyDown(touch, { code: 'Enter', key: 'Enter' });
    expect(touch.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '退出全屏或大屏' }));
    await waitFor(() => expect(machine().dataset.presentation).toBe('window'));
    expect(boundary.adapter!.setButton).toHaveBeenCalledWith(1, 'a', false);
    expect(touch.getAttribute('aria-pressed')).toBe('false'); expect(fullscreen.exit).not.toHaveBeenCalled();
    expect(document.body.classList.contains('player-presentation-open')).toBe(false);
    expect(boundary.adapter!.saveState).not.toHaveBeenCalled(); expect(uploads()).toHaveLength(0);
  });

  it('releases physical and touch sources on browser fullscreenchange, including browser-initiated exit', async () => {
    const fullscreen = mockFullscreen();
    await setup({ playerSettings: { ...settings, showTouchControls: true } }); await start();
    fireEvent.keyDown(canvas(), { code: 'KeyX', key: 'x' });
    act(() => fullscreen.change(machine()));
    expect(machine().dataset.presentation).toBe('fullscreen');
    expect(boundary.adapter!.setButton).toHaveBeenLastCalledWith(1, 'a', false);
    const touch = screen.getByRole('button', { name: 'B 按键' });
    act(() => touch.focus()); fireEvent.keyDown(touch, { code: 'Space', key: ' ' });
    expect(touch.getAttribute('aria-pressed')).toBe('true');
    act(() => fullscreen.change(null));
    expect(machine().dataset.presentation).toBe('window');
    expect(boundary.adapter!.setButton).toHaveBeenLastCalledWith(1, 'b', false);
    expect(touch.getAttribute('aria-pressed')).toBe('false');
    fireEvent.keyDown(touch, { code: 'Space', key: ' ', repeat: true });
    expect(touch.getAttribute('aria-pressed')).toBe('false');
    expect(boundary.adapter!.destroy).not.toHaveBeenCalled();
  });

  it('renders current custom 1P and 2P hints instead of default key labels', async () => {
    const custom = { ...settings, keyboardMappings: {
      1: { up: 'KeyI', down: 'KeyK', left: 'KeyJ', right: 'KeyL', a: 'KeyQ', b: 'KeyE', start: 'Space', select: 'ControlLeft' },
      2: { up: 'Digit8', down: 'Digit5', left: 'Digit4', right: 'Digit6', a: 'KeyO', b: 'KeyP', start: 'KeyN', select: 'AltRight' },
    } };
    await setup({ playerSettings: custom });
    const hints = screen.getByRole('region', { name: '当前游戏键位' });
    const labels = () => Array.from(hints.querySelectorAll('kbd'), (key) => key.textContent);
    expect(within(hints).getByText('1P 键盘')).toBeDefined();
    expect(labels()).toEqual(['I K J L', 'Q', 'E', 'Space', '左 Ctrl']);
    fireEvent.click(within(hints).getByRole('button', { name: '切换查看玩家键位' }));
    expect(within(hints).getByText('2P 键盘')).toBeDefined();
    expect(labels()).toEqual(['8 5 4 6', 'O', 'P', 'N', '右 Alt']);
    fireEvent.click(screen.getByRole('button', { name: '查看这张卡带怎么玩' }));
    const help = await screen.findByRole('dialog', { name: '这张卡带怎么玩' });
    const players = help.querySelectorAll('.player-help-mappings section');
    expect(Array.from(players[0].querySelectorAll('kbd'), (key) => key.textContent)).toEqual(['I', 'K', 'J', 'L', 'Q', 'E', 'Space', '左 Ctrl']);
    expect(Array.from(players[1].querySelectorAll('kbd'), (key) => key.textContent)).toEqual(['8', '5', '4', '6', 'O', 'P', 'N', '右 Alt']);
  });

  it.each([
    ['查看这张卡带怎么玩', '这张卡带怎么玩'],
    ['重置卡带', '重新启动卡带'],
  ])('opening %s pauses and stops all inputs without saving or resetting before confirmation', async (button, title) => {
    await setup({ playerSettings: { ...settings, showTouchControls: true } }); await start();
    fireEvent.keyDown(canvas(), { code: 'KeyX', key: 'x' });
    expect(boundary.adapter!.setButton).toHaveBeenCalledWith(1, 'a', true);
    fireEvent.click(screen.getByRole('button', { name: button }));
    const dialog = await screen.findByRole('dialog', { name: title });
    await screen.findByRole('button', { name: '继续运行卡带' });
    expect(boundary.adapter!.pause).toHaveBeenCalled();
    expect(boundary.adapter!.setButton).toHaveBeenCalledWith(1, 'a', false);
    const count = vi.mocked(boundary.adapter!.setButton).mock.calls.length;
    fireEvent.keyDown(canvas(), { code: 'KeyX', key: 'x' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'A 按键' }), { code: 'Enter', key: 'Enter' });
    expect(vi.mocked(boundary.adapter!.setButton).mock.calls).toHaveLength(count);
    expect((screen.getByRole('button', { name: 'A 按键' }) as HTMLButtonElement).disabled).toBe(true);
    expect(boundary.adapter!.reset).not.toHaveBeenCalled(); expect(boundary.adapter!.saveState).not.toHaveBeenCalled();
    expect(uploads()).toHaveLength(0); expect(sessionStorage.length).toBe(0);
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭对话框' }));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(boundary.adapter!.start).toHaveBeenCalledTimes(1);
    await resume();
    fireEvent.keyDown(canvas(), { code: 'ArrowUp', key: 'ArrowUp' });
    expect(boundary.adapter!.setButton).toHaveBeenLastCalledWith(1, 'up', true);
  });

  it('Escape leaves theater only when no dialog is open and releases active game input', async () => {
    mockFullscreen('unsupported'); await setup(); await start();
    fireEvent.click(screen.getByRole('button', { name: '全屏游玩' }));
    await waitFor(() => expect(machine().dataset.presentation).toBe('theater'));
    fireEvent.click(screen.getByRole('button', { name: '查看这张卡带怎么玩' }));
    const help = await screen.findByRole('dialog', { name: '这张卡带怎么玩' });
    await screen.findByRole('button', { name: '继续运行卡带' });
    fireEvent.keyDown(help, { code: 'Escape', key: 'Escape' });
    expect(machine().dataset.presentation).toBe('theater');
    fireEvent.click(within(help).getByRole('button', { name: '关闭对话框' })); await resume();
    fireEvent.keyDown(canvas(), { code: 'KeyX', key: 'x' });
    const escape = new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true });
    fireEvent(canvas(), escape);
    expect(escape.defaultPrevented).toBe(true); expect(machine().dataset.presentation).toBe('window');
    expect(boundary.adapter!.setButton).toHaveBeenLastCalledWith(1, 'a', false);
  });

  it('opens input settings only after pause and fullscreen exit, retaining emulator and pending save session', async () => {
    const fullscreen = mockFullscreen(); const opened = vi.fn();
    write = async () => json({ error: '服务器离线' }, 503);
    await setup({ onOpenInputSettings: opened }); await start();
    fireEvent.click(screen.getByRole('button', { name: '保存进度' }));
    await screen.findByText('有一份尚未上传的本地快照');
    const retained = sessionStorage.getItem('xnbw:pending:fixture');
    expect(storedSnapshotBytes(JSON.parse(retained!)[0])).toEqual([7, 8, 9]); state[0] = 99;
    fireEvent.click(screen.getByRole('button', { name: '全屏游玩' }));
    await waitFor(() => expect(machine().dataset.presentation).toBe('fullscreen'));
    fireEvent.keyDown(canvas(), { code: 'KeyX', key: 'x' });
    const pausing = deferred<void>(); const exiting = deferred<void>();
    vi.mocked(boundary.adapter!.pause).mockImplementationOnce(() => pausing.promise);
    fullscreen.exit.mockImplementationOnce(async () => { await exiting.promise; fullscreen.change(null); });
    fireEvent.click(screen.getByRole('button', { name: '按键设置' }));
    expect(boundary.adapter!.setButton).toHaveBeenLastCalledWith(1, 'a', false);
    expect(boundary.adapter!.pause).toHaveBeenCalledTimes(1); expect(fullscreen.exit).not.toHaveBeenCalled(); expect(opened).not.toHaveBeenCalled();
    await act(async () => { pausing.resolve(); });
    expect(fullscreen.exit).toHaveBeenCalledTimes(1); expect(opened).not.toHaveBeenCalled();
    await act(async () => { exiting.resolve(); });
    expect(opened).toHaveBeenCalledTimes(1); expect(machine().dataset.presentation).toBe('window');
    expect(screen.getByTestId('route').textContent).toBe('player');
    expect(boundary.adapter!.load).toHaveBeenCalledTimes(1); expect(boundary.adapter!.destroy).not.toHaveBeenCalled();
    expect(boundary.adapter!.saveState).toHaveBeenCalledTimes(1); expect(uploads()).toHaveLength(1);
    expect(sessionStorage.getItem('xnbw:pending:fixture')).toBe(retained);
    expect(screen.getByRole('button', { name: '继续运行卡带' })).toBeDefined();
    await resume();
    write = async () => json(record(1)); fireEvent.click(screen.getByRole('button', { name: '重试上传' }));
    await screen.findByText('已保存到槽位 1。');
    expect(Array.from(uploads()[1].bytes)).toEqual([7, 8, 9]); expect(sessionStorage.length).toBe(0);
    expect(boundary.adapter!.load).toHaveBeenCalledTimes(1); expect(boundary.adapter!.saveState).toHaveBeenCalledTimes(1);
  });
});
