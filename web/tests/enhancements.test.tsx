// Unit & component tests for P0-P2 enhancements (turbo, sliding 8-way D-pad, Base64 save session,
// fast-forward, quick shortcuts, 10 slots + delete, saves-only backup, .zip import, smart touch default).
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, normalizeGame } from '../src/api/client';
import { SaveSession } from '../src/emulator/saveSession';
import { applyGameGeniePatches, parseCheatCode } from '../src/emulator/gameGenie';
import { RewindBuffer } from '../src/emulator/rewind';
import { InputController } from '../src/input/controller';
import { usePhysicalInputs } from '../src/input/usePhysicalInputs';
import { DEFAULT_MAPPINGS } from '../src/input/mappings';
import { TouchControls } from '../src/input/TouchControls';
import { ImportDialog } from '../src/components/ImportDialog';
import { SettingsDialog } from '../src/components/SettingsDialog';
import { AboutDialog } from '../src/components/AboutDialog';
import { PlayerPage } from '../src/pages/PlayerPage';
import { GameDetailPage } from '../src/pages/GameDetailPage';
import { LibraryPage } from '../src/pages/LibraryPage';
import { applyColorScheme, setAutoPauseOnBlur } from '../src/preferences';
import { currentRoute } from '../src/hooks/useRoute';
import { DEFAULT_SETTINGS, type Game, type SaveRecord } from '../src/types';
import type { EmulatorAdapter } from '../src/emulator/adapter';

function stubAdapter(setButton: EmulatorAdapter['setButton']): EmulatorAdapter {
  return {
    name: 'FCEUmm', version: 'test-v1', capabilities: { saveRAM: true, saveState: true, audio: true, keyboard: true },
    load: async () => {}, start: () => {}, pause: () => {}, reset: () => {}, destroy: () => {},
    setButton, setKeyboardKey: () => {}, setKeyboardDevice: () => {}, releaseAll: () => {}, setVolume: () => {},
    saveState: () => new Uint8Array(), getSaveRAM: () => new Uint8Array(), loadState: () => {}, loadSaveRAM: () => {},
  };
}

const boundary = vi.hoisted(() => ({ adapter: null as EmulatorAdapter | null }));
vi.mock('../src/emulator/adapter', async (original) => ({
  ...await original<typeof import('../src/emulator/adapter')>(),
  createAdapter: vi.fn(async () => ({ status: 'ready', adapter: boundary.adapter })),
}));

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
const fixtureGame = normalizeGame({ id: 'contra-demo', title: '测试魂斗罗', sha256: 'b'.repeat(64), filename: 'contra.nes' })!;

function dispatchPointer(target: Element, type: string, pointerId: number, clientX = 0, clientY = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(target, event);
}

beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('P0-P2 frontend enhancements', () => {
  it('pulses turbo A/B immediately and stops cleanly on releaseSource and releaseAll', () => {
    vi.useFakeTimers();
    const calls: [number, string, boolean][] = [];
    const input = new InputController();
    input.attach(stubAdapter((player, button, pressed) => { calls.push([player, button, pressed]); }));

    input.setTurbo('physical:KeyC', 1, 'a', true);
    expect(input.getSnapshot().turbo.has('1:a')).toBe(true);
    expect(calls.at(-1)).toEqual([1, 'a', true]);

    vi.advanceTimersByTime(35);
    expect(calls.at(-1)).toEqual([1, 'a', false]);
    vi.advanceTimersByTime(35);
    expect(calls.at(-1)).toEqual([1, 'a', true]);

    input.releaseSource('physical:KeyC');
    expect(input.getSnapshot().turbo.has('1:a')).toBe(false);
    expect(calls.at(-1)).toEqual([1, 'a', false]);

    const afterRelease = calls.length;
    vi.advanceTimersByTime(200);
    expect(calls.length).toBe(afterRelease);
  });

  it('resolves 8-way sliding D-pad directions including diagonals from center slide', () => {
    const input = new InputController();
    const pressed: [number, string, boolean][] = [];
    input.attach(stubAdapter((player, button, value) => { pressed.push([player, button, value]); }));

    const view = render(<TouchControls input={input} enabled/>);
    const pad = view.getByRole('group', { name: '方向十字键（支持滑动与斜向）' });
    vi.spyOn(pad, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
    });

    // Start in center deadzone, then slide right, then slide down-right diagonal, then release.
    dispatchPointer(pad, 'pointerdown', 7, 50, 50);
    expect(input.getSnapshot().buttons.size).toBe(0);

    dispatchPointer(pad, 'pointermove', 7, 90, 50);
    expect([...input.getSnapshot().buttons]).toEqual(['1:right']);

    dispatchPointer(pad, 'pointermove', 7, 90, 90);
    expect(input.getSnapshot().buttons.has('1:right')).toBe(true);
    expect(input.getSnapshot().buttons.has('1:down')).toBe(true);

    dispatchPointer(pad, 'pointerup', 7, 90, 90);
    expect(input.getSnapshot().buttons.size).toBe(0);
    expect(pressed.some(([, btn, val]) => btn === 'down' && val === true)).toBe(true);
  });

  it('persists SaveSession using compact Base64 and remains backwards-compatible with legacy byte arrays', () => {
    const session = new SaveSession(fixtureGame.id);
    session.retain({
      game: fixtureGame, kind: 'state', slot: 9, core: 'fceumm', coreVersion: '1.0',
      bytes: new Uint8Array([0, 1, 127, 128, 255]),
    });
    const raw = JSON.parse(sessionStorage.getItem(`xnbw:pending:${fixtureGame.id}`)!);
    expect(raw[0].bytesB64).toBe(btoa(String.fromCharCode(0, 1, 127, 128, 255)));
    expect(raw[0].bytes).toBeUndefined();

    const restored = new SaveSession(fixtureGame.id);
    expect(restored.pending).toHaveLength(1);
    expect(restored.pending[0].slot).toBe(9);
    expect([...restored.pending[0].bytes]).toEqual([0, 1, 127, 128, 255]);

    // Legacy array format still loads cleanly
    sessionStorage.setItem('xnbw:pending:legacy-test', JSON.stringify([{
      game: { ...fixtureGame, id: 'legacy-test' }, kind: 'state', slot: 2, core: 'fceumm', coreVersion: '1.0', bytes: [10, 20, 30],
    }]));
    const legacy = new SaveSession('legacy-test');
    expect(legacy.pending).toHaveLength(1);
    expect([...legacy.pending[0].bytes]).toEqual([10, 20, 30]);
  });

  it('defaults showTouchControls using pointer: coarse media query when server omits the field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ volume: 0.7 })));
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(pointer: coarse)' ? false : false })));
    const desktop = await api.settings();
    expect(desktop.showTouchControls).toBe(false);

    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(pointer: coarse)' })));
    const mobile = await api.settings();
    expect(mobile.showTouchControls).toBe(true);
  });

  it('accepts .nes and .zip files in ImportDialog and rejects unrelated extensions', () => {
    const view = render(<ImportDialog onClose={() => {}} onImported={() => {}} onNas={() => {}}/>);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe('.nes,.zip');

    const nes = new File([new Uint8Array([78, 69, 83, 26])], 'contra.nes');
    const zip = new File([new Uint8Array([80, 75, 3, 4])], 'mario.zip');
    const bad = new File(['hello'], 'readme.txt');
    fireEvent.change(input, { target: { files: [nes, zip, bad] } });

    expect(screen.getByText('contra.nes')).toBeDefined();
    expect(screen.getByText('mario.zip')).toBeDefined();
    expect(screen.queryByText('readme.txt')).toBeNull();
    expect(screen.getByText(/请选择 \.nes 卡带文件或单卡 \.zip 压缩包/)).toBeDefined();
  });

  it('downloads saves-only backup via /api/backup?mode=saves in SettingsDialog', async () => {
    const requestedUrls: string[] = [];
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:saves') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const downloadNames: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { downloadNames.push(this.download); });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requestedUrls.push(url);
      if (url.includes('/api/settings')) return json(DEFAULT_SETTINGS);
      if (url.includes('/api/backup')) return new Response(new Uint8Array([80, 75, 3, 4]), { headers: { 'Content-Type': 'application/zip' } });
      throw new Error(`Unexpected ${url}`);
    }));

    render(<SettingsDialog initialTab="backup" onClose={() => {}} onSaved={() => {}} onRestored={() => {}}/>);
    const btn = await screen.findByRole('button', { name: '仅备份存档与设置' });
    fireEvent.click(btn);
    await waitFor(() => expect(downloadNames).toHaveLength(1));
    expect(requestedUrls.some((url) => url.endsWith('/api/backup?mode=saves'))).toBe(true);
    expect(downloadNames[0]).toContain('存档备份');
  });

  it('supports 2x fast-forward (F9), 10 save slots, slot deletion, and collapsible sidebar in PlayerPage', async () => {
    let records: SaveRecord[] = [{
      id: 'state-5', gameId: fixtureGame.id, kind: 'state', slot: 5,
      core: 'fceumm', coreVersion: 'test-v1', romSha256: fixtureGame.sha256,
      etag: '"etag-slot-5"', createdAt: '2026-11-25T10:00:00Z', url: '/api/saves/state-5', size: 3,
    }];
    const deleted: { path: string; ifMatch: string | null }[] = [];
    const setSpeed = vi.fn();
    boundary.adapter = {
      name: 'FCEUmm', version: 'test-v1', capabilities: { saveRAM: true, saveState: true, audio: true, keyboard: true },
      load: vi.fn(async () => {}), start: vi.fn(), pause: vi.fn(), reset: vi.fn(), destroy: vi.fn(),
      setButton: vi.fn(), setKeyboardKey: vi.fn(), setKeyboardDevice: vi.fn(), releaseAll: vi.fn(), setVolume: vi.fn(),
      setSpeed, saveState: vi.fn(() => new Uint8Array([1, 2, 3])), getSaveRAM: vi.fn(() => new Uint8Array()),
      loadState: vi.fn(), loadSaveRAM: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url, window.location.origin).pathname;
      const method = init.method || 'GET';
      if (path === `/api/games/${fixtureGame.id}`) return json(fixtureGame);
      if (path === `/api/games/${fixtureGame.id}/launch`) return json({ romUrl: '/roms/contra.nes' });
      if (path === '/roms/contra.nes') return new Response(new Uint8Array([78, 69, 83, 26]));
      if (path === '/api/saves' && method === 'GET') return json(records);
      if (path === '/api/saves/state-5' && method === 'DELETE') {
        deleted.push({ path, ifMatch: new Headers(init.headers).get('If-Match') });
        records = [];
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected ${method} ${path}`);
    }));

    const onPlayed = vi.fn();
    render(<PlayerPage id={fixtureGame.id} health={null} settings={{ ...DEFAULT_SETTINGS, showTouchControls: false }} onPlayed={onPlayed}/>);
    await screen.findByRole('button', { name: '开始运行卡带' });

    // Start, pause, resume -> onPlayed called only once per session
    fireEvent.click(screen.getByRole('button', { name: '开始运行卡带' }));
    await screen.findByRole('button', { name: '暂停运行' });
    fireEvent.click(screen.getByRole('button', { name: '暂停运行' }));
    await screen.findByRole('button', { name: '继续运行卡带' });
    fireEvent.click(screen.getByRole('button', { name: '继续运行卡带' }));
    await screen.findByRole('button', { name: '暂停运行' });
    expect(onPlayed).toHaveBeenCalledTimes(1);

    // Toggle 2x fast-forward via F9 shortcut
    fireEvent.keyDown(window, { code: 'F9', key: 'F9' });
    await waitFor(() => expect(setSpeed).toHaveBeenLastCalledWith(2));
    fireEvent.keyDown(window, { code: 'F9', key: 'F9' });
    await waitFor(() => expect(setSpeed).toHaveBeenLastCalledWith(1));

    // Toggle collapsible sidebar
    const sidebarBtn = screen.getByRole('button', { name: '收起存档侧栏' });
    fireEvent.click(sidebarBtn);
    expect(screen.getByRole('button', { name: '展开存档侧栏' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '展开存档侧栏' }));

    // Select slot 5 out of 10 and delete it
    const select = screen.getByLabelText('即时存档槽位') as HTMLSelectElement;
    expect(select.options).toHaveLength(10);
    fireEvent.change(select, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: '删除此槽位存档' }));
    await screen.findByRole('dialog', { name: '删除即时存档' });
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await screen.findByText('已删除槽位 5 的存档。');
    expect(deleted).toEqual([{ path: '/api/saves/state-5', ifMatch: '"etag-slot-5"' }]);
  });

  it('switches color-scheme meta and localStorage cleanly via SettingsDialog', async () => {
    const meta = document.createElement('meta');
    meta.name = 'color-scheme';
    meta.content = 'light dark';
    document.head.appendChild(meta);
    try {
      vi.stubGlobal('fetch', vi.fn(async () => json(DEFAULT_SETTINGS)));
      render(<SettingsDialog initialTab="general" onClose={() => {}} onSaved={() => {}} onRestored={() => {}}/>);
      const select = await screen.findByLabelText('界面外观') as HTMLSelectElement;
      fireEvent.change(select, { target: { value: 'dark' } });
      expect(meta.content).toBe('dark');
      fireEvent.change(select, { target: { value: 'system' } });
      expect(meta.content).toBe('light dark');
    } finally {
      applyColorScheme('system');
      meta.remove();
    }
  });

  it('starts from ready on Enter, captures cover PNG, auto-loads initialSlot, and respects autoPauseOnBlur=false', async () => {
    setAutoPauseOnBlur(false);
    const uploads: string[] = [];
    const loadState = vi.fn();
    boundary.adapter = {
      name: 'FCEUmm', version: 'test-v1', capabilities: { saveRAM: true, saveState: true, audio: true, keyboard: true },
      load: vi.fn(async () => {}), start: vi.fn(), pause: vi.fn(), reset: vi.fn(), destroy: vi.fn(),
      setButton: vi.fn(), setKeyboardKey: vi.fn(), setKeyboardDevice: vi.fn(), releaseAll: vi.fn(), setVolume: vi.fn(),
      saveState: vi.fn(() => new Uint8Array([1, 2, 3])), getSaveRAM: vi.fn(() => new Uint8Array()),
      loadState, loadSaveRAM: vi.fn(),
    };
    const slot2: SaveRecord = {
      id: 'state-2', gameId: fixtureGame.id, kind: 'state', slot: 2,
      core: 'fceumm', coreVersion: 'test-v1', romSha256: fixtureGame.sha256,
      etag: '"etag-2"', createdAt: '2026-11-25T10:00:00Z', url: '/api/saves/state-2', size: 4,
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url, window.location.origin).pathname;
      const method = init.method || 'GET';
      if (path === `/api/games/${fixtureGame.id}`) return json(fixtureGame);
      if (path === `/api/games/${fixtureGame.id}/launch`) return json({ romUrl: '/roms/contra.nes' });
      if (path === '/roms/contra.nes') return new Response(new Uint8Array([78, 69, 83, 26]));
      if (path === '/api/saves') return json([slot2]);
      if (path === '/api/saves/state-2') return new Response(new Uint8Array([9, 8, 7, 6]));
      if (path === `/api/games/${fixtureGame.id}/cover` && method === 'PUT') {
        uploads.push(path);
        return json({ ...fixtureGame, coverUrl: `/api/games/${fixtureGame.id}/cover?v=abcdef123456` });
      }
      throw new Error(`Unexpected ${method} ${path}`);
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
      cb(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }));
    });

    const onCoverUpdated = vi.fn();
    render(<PlayerPage id={fixtureGame.id} initialSlot={2} health={null} settings={{ ...DEFAULT_SETTINGS, showTouchControls: false }} onPlayed={() => {}} onCoverUpdated={onCoverUpdated}/>);
    await screen.findByText('已载入槽位 2，点击或按 Enter 继续运行。');
    expect(loadState).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.player-screen .player-hud-toast')).not.toBeNull();

    // Press Enter on window to start from ready overlay
    fireEvent.keyDown(window, { code: 'Enter', key: 'Enter' });
    await screen.findByRole('button', { name: '暂停运行' });

    // Blur does not pause when autoPauseOnBlur is false
    fireEvent(window, new Event('blur'));
    expect(boundary.adapter.pause).not.toHaveBeenCalled();

    // Capture current frame as cover
    fireEvent.click(screen.getByRole('button', { name: '设为卡带封面' }));
    await screen.findByText('已将当前画面设为卡带封面。');
    expect(uploads).toEqual([`/api/games/${fixtureGame.id}/cover`]);
    expect(onCoverUpdated).toHaveBeenCalledTimes(1);
    setAutoPauseOnBlur(true);
  });

  it('toggles favorite optimistically on GameDetailPage and navigates to player slot from save list', async () => {
    window.history.replaceState(null, '', `#/game/${fixtureGame.id}`);
    let gameFetches = 0;
    const slot3: SaveRecord = {
      id: 'state-3', gameId: fixtureGame.id, kind: 'state', slot: 3,
      core: 'fceumm', coreVersion: 'test-v1', romSha256: fixtureGame.sha256,
      etag: '"etag-3"', createdAt: '2026-11-25T10:00:00Z', url: '/api/saves/state-3', size: 2048,
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = new URL(url, window.location.origin).pathname;
      if (path === `/api/games/${fixtureGame.id}`) { gameFetches++; return json(fixtureGame); }
      if (path === '/api/saves') return json([slot3]);
      throw new Error(`Unexpected ${path}`);
    }));
    const onFavorite = vi.fn(async () => {});
    render(<GameDetailPage id={fixtureGame.id} refreshLibrary={() => {}} onFavorite={onFavorite} pendingFavorite={null}/>);
    await screen.findByRole('heading', { name: '测试魂斗罗' });
    expect(gameFetches).toBe(1);

    // Optimistic favorite does not refetch detail page
    const favBtn = screen.getByRole('button', { name: '收藏卡带' });
    fireEvent.click(favBtn);
    await screen.findByRole('button', { name: '已收藏' });
    expect(gameFetches).toBe(1);

    // Clicking "从此槽位开始" navigates to #/play/<id>?slot=3
    fireEvent.click(screen.getByRole('button', { name: '从此槽位开始' }));
    await waitFor(() => expect(currentRoute()).toEqual({ page: 'player', id: fixtureGame.id, slot: 3 }));
  });

  it('renders continue banner, skeletons, and bulk delete for imported games in LibraryPage', async () => {
    const imported: Game = { ...fixtureGame, source: 'imported', readOnly: false, lastPlayedAt: '2026-11-25T09:00:00Z' };
    const bundled: Game = { ...fixtureGame, id: 'table-tennis', title: '复古乒乓', source: 'bundled', readOnly: true, lastPlayedAt: null };
    const deleted: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url, window.location.origin).pathname;
      if (init.method === 'DELETE' && path.startsWith('/api/games/')) {
        deleted.push(path);
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected ${init.method} ${path}`);
    }));

    const refresh = vi.fn();
    const baseQuery = {
      preferences: { view: 'all' as const, category: 'all' as const, sort: 'added' as const, search: '', layout: 'grid' as const, page: 1, pageSize: 20 as const },
      change: vi.fn(),
      result: { games: [imported, bundled], total: 2, page: 1, pageSize: 20, totalPages: 1, rangeStart: 1, rangeEnd: 2, stats: { total: 2, favorites: 0, recent: 1 } },
      loading: false, error: '', allStatus: 'idle' as const, refresh, cancelAll: vi.fn(),
    };

    const { rerender } = render(<LibraryPage query={{ ...baseQuery, result: null, loading: true }} onImport={() => {}} onFavorite={async () => {}} pendingFavorite={null}/>);
    expect(document.querySelectorAll('.skeleton-card').length).toBeGreaterThan(0);

    rerender(<LibraryPage query={baseQuery} onImport={() => {}} onFavorite={async () => {}} pendingFavorite={null}/>);
    expect(screen.getByRole('region', { name: '继续上次游玩' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '批量管理' }));
    // Only imported game gets a selection checkbox; bundled stays read-only
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(1);
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole('button', { name: '批量删除' }));
    await screen.findByRole('dialog', { name: '批量删除个人卡带' });
    fireEvent.click(screen.getByRole('button', { name: '确认删除 1 张' }));
    await screen.findByText('已删除 1 张个人卡带。');
    expect(deleted).toEqual([`/api/games/${imported.id}`]);
    expect(refresh).toHaveBeenCalled();
  });

  it('adapts AboutDialog source link when external SOURCE-OFFER.json is served', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('SOURCE-OFFER.json')) {
        return json({ archive: '小牛霸王学习机-源码.zip', sha256: 'deadbeef1234567890', repositoryUrl: 'https://github.com/songdone/XiaoNiuBaWang' });
      }
      if (url.includes('/api/support-assets')) return json({ assets: [], disabled: true });
      throw new Error(`Unexpected ${url}`);
    }));
    render(<AboutDialog version="0.3.0" onClose={() => {}}/>);
    const repoLink = await screen.findByRole('link', { name: '获取伴随对应源码' });
    expect(repoLink.getAttribute('href')).toBe('https://github.com/songdone/XiaoNiuBaWang');
    expect(screen.getByText(/deadbeef1234/)).toBeDefined();
  });

  it('auto-focuses canvas on mapped game keys from idle body/main focus without stealing control focus', () => {
    const main = document.createElement('main'); main.id = 'main-content'; main.tabIndex = -1;
    const canvas = document.createElement('canvas'); canvas.tabIndex = 0;
    const toolbarBtn = document.createElement('button');
    const textInput = document.createElement('input');
    main.append(canvas, toolbarBtn, textInput);
    document.body.append(main);
    const setButton = vi.fn();
    const adapter = stubAdapter(setButton);
    const input = new InputController(); input.attach(adapter);
    const scope = { current: main };
    const fallback = { current: canvas };
    const hook = renderHook(() => usePhysicalInputs(input, true, false, DEFAULT_MAPPINGS, scope, fallback));

    // Focus on body -> mapped KeyX focuses canvas and dispatches immediately
    act(() => { document.body.focus(); });
    const fromBody = new KeyboardEvent('keydown', { code: 'KeyX', bubbles: true, cancelable: true });
    act(() => { document.body.dispatchEvent(fromBody); });
    expect(fromBody.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(canvas);
    expect(setButton).toHaveBeenCalledWith(1, 'a', true);
    act(() => input.releaseAll());
    setButton.mockClear();

    // Focus on #main-content -> mapped ArrowRight also focuses canvas
    act(() => { main.focus(); });
    const fromMain = new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true, cancelable: true });
    act(() => { main.dispatchEvent(fromMain); });
    expect(fromMain.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(canvas);
    expect(setButton).toHaveBeenCalledWith(1, 'right', true);
    act(() => input.releaseAll());
    setButton.mockClear();

    // Focus on real button or input -> NEVER steals focus or dispatches game input
    act(() => { toolbarBtn.focus(); });
    const fromBtn = new KeyboardEvent('keydown', { code: 'KeyX', bubbles: true, cancelable: true });
    act(() => { toolbarBtn.dispatchEvent(fromBtn); });
    expect(fromBtn.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(toolbarBtn);
    expect(setButton).not.toHaveBeenCalled();

    act(() => { textInput.focus(); });
    const fromInput = new KeyboardEvent('keydown', { code: 'KeyX', bubbles: true, cancelable: true });
    act(() => { textInput.dispatchEvent(fromInput); });
    expect(fromInput.defaultPrevented).toBe(false);
    expect(setButton).not.toHaveBeenCalled();

    hook.unmount();
    main.remove();
  });

  it('provides quick rename buttons on LibraryPage cards, GameDetailPage title, and PlayerPage heading for imported games', async () => {
    const imported: Game = { ...fixtureGame, source: 'imported', readOnly: false };
    const bundled: Game = { ...fixtureGame, id: 'table-tennis', title: '复古乒乓', source: 'bundled', readOnly: true };
    const renamedCalls: Array<{ path: string; title: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url, window.location.origin).pathname;
      if (init.method === 'PUT' && path.startsWith('/api/games/')) {
        renamedCalls.push({ path, title: JSON.parse(String(init.body)).title });
        return json({ ...imported, title: JSON.parse(String(init.body)).title });
      }
      if (path === `/api/games/${imported.id}`) return json(imported);
      if (path === `/api/games/${imported.id}/launch`) return json({ romUrl: '/roms/test.nes' });
      if (path === '/roms/test.nes') return new Response(new Uint8Array([0x4e, 0x45, 0x53, 0x1a]), { status: 200 });
      if (path === '/api/saves') return json([]);
      throw new Error(`Unexpected ${init.method || 'GET'} ${path}`);
    }));

    // 1. LibraryPage card quick rename (only for imported games)
    const refresh = vi.fn();
    const query = {
      preferences: { view: 'all' as const, category: 'all' as const, sort: 'added' as const, search: '', layout: 'grid' as const, page: 1, pageSize: 20 as const },
      change: vi.fn(),
      result: { games: [imported, bundled], total: 2, page: 1, pageSize: 20, totalPages: 1, rangeStart: 1, rangeEnd: 2, stats: { total: 2, favorites: 0, recent: 0 } },
      loading: false, error: '', allStatus: 'idle' as const, refresh, cancelAll: vi.fn(),
    };
    const lib = render(<LibraryPage query={query} onImport={() => {}} onFavorite={async () => {}} pendingFavorite={null}/>);
    expect(screen.queryByRole('button', { name: '重命名 复古乒乓' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重命名 测试魂斗罗' }));
    const libDialog = await screen.findByRole('dialog', { name: '重命名卡带' });
    const libInput = libDialog.querySelector('input')!;
    fireEvent.change(libInput, { target: { value: '松鼠诺娃' } });
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
    await screen.findByText('已将卡带重命名为“松鼠诺娃”。');
    expect(renamedCalls[0]).toEqual({ path: `/api/games/${imported.id}`, title: '松鼠诺娃' });
    expect(refresh).toHaveBeenCalled();
    lib.unmount();

    // 2. GameDetailPage inline title rename button
    const detail = render(<GameDetailPage id={imported.id} refreshLibrary={refresh} onFavorite={async () => {}} pendingFavorite={null}/>);
    await screen.findByRole('heading', { name: '测试魂斗罗' });
    expect(screen.getByRole('button', { name: '重命名卡带' })).toBeDefined();
    detail.unmount();

    // 3. PlayerPage inline heading rename + running dynamic footer hint
    boundary.adapter = stubAdapter(vi.fn());
    const onRenamed = vi.fn();
    render(<PlayerPage id={imported.id} health={null} settings={DEFAULT_SETTINGS} onPlayed={() => {}} onRenamed={onRenamed}/>);
    await screen.findByRole('heading', { name: '测试魂斗罗' });
    await screen.findByRole('button', { name: '开始运行卡带' });
    fireEvent.click(screen.getByRole('button', { name: '开始运行卡带' }));
    await screen.findByText(/键盘已就绪 · 开始 Enter · 确认\/跳 X \(A\)/);

    fireEvent.click(screen.getByRole('button', { name: '重命名卡带' }));
    const playDialog = await screen.findByRole('dialog', { name: '重命名卡带' });
    fireEvent.change(playDialog.querySelector('input')!, { target: { value: '魂斗罗测试版' } });
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
    await screen.findByRole('heading', { name: '魂斗罗测试版' });
    expect(onRenamed).toHaveBeenCalled();
  });

  it('decodes 6-char & 8-char Game Genie codes, RAM locks, patches PRG-ROM without mutating source, and manages RewindBuffer', () => {
    // Classic 6-char Super Mario Bros infinite lives (SXIOPO -> $91D9 = 0xAD)
    expect(parseCheatCode('sxiopo')).toEqual({ kind: 'gg', code: 'SXIOPO', address: 0x91d9, value: 0xad });
    // Classic 8-char Contra infinite lives (SLXPLOVS -> $9123, compare 0xDE -> 0xBD)
    expect(parseCheatCode('SLXP-LOVS')).toEqual({ kind: 'gg', code: 'SLXPLOVS', address: 0x9123, value: 0xbd, compare: 0xde });
    // RAM lock
    expect(parseCheatCode('$0032:1e')).toEqual({ kind: 'ram', code: '0032:1E', address: 0x0032, value: 0x1e });
    // Rejects invalid code and out-of-range RAM address
    expect(() => parseCheatCode('INVALID!')).toThrow(/金手指格式无效|无效字符/);
    expect(() => parseCheatCode('2000:FF')).toThrow(/0000–07FF/);

    // Synthetic 32 KiB NROM iNES ROM: put compare byte 0xDE at CPU $9123 (file offset 16 + 0x1123)
    const rom = new Uint8Array(16 + 32768);
    rom.set([0x4e, 0x45, 0x53, 0x1a, 2, 0, 0, 0]);
    const targetOffset = 16 + (0x9123 - 0x8000);
    rom[targetOffset] = 0xde;
    const patched = applyGameGeniePatches(rom, [
      { id: '1', code: 'SLXPLOVS', label: '无限生命', enabled: true },
      { id: '2', code: '0032:1E', label: '30条命', enabled: true },
    ]);
    expect(patched.patchedBytes).toBe(1);
    expect(patched.bytes[targetOffset]).toBe(0xbd);
    expect(rom[targetOffset]).toBe(0xde); // Original untouched
    expect(patched.ramLocks).toEqual([{ address: 0x0032, value: 0x1e }]);

    // RewindBuffer ring behavior
    const buf = new RewindBuffer(3);
    buf.push(new Uint8Array([1]));
    buf.push(new Uint8Array([2]));
    buf.push(new Uint8Array([3]));
    buf.push(new Uint8Array([4]));
    expect(buf.size).toBe(3);
    expect(Array.from(buf.pop()!)).toEqual([4]);
    expect(Array.from(buf.pop()!)).toEqual([3]);
    expect(Array.from(buf.pop()!)).toEqual([2]);
    expect(buf.pop()).toBeNull();
  });

  it('applies WASD keybinding preset in SettingsDialog and shows 立即试玩 after single-ROM ImportDialog upload', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url, window.location.origin).pathname;
      if (path === '/api/settings' && (!init.method || init.method === 'GET')) return json(DEFAULT_SETTINGS);
      if (path === '/api/settings' && init.method === 'PUT') return json({ ok: true });
      if (path === '/api/games' && init.method === 'POST') return json({ game: fixtureGame }, 201);
      throw new Error(`Unexpected ${init.method || 'GET'} ${path}`);
    }));

    const onSaved = vi.fn();
    const s = render(<SettingsDialog initialTab="input" onClose={() => {}} onSaved={onSaved} onRestored={() => {}}/>);
    await screen.findByText('经典 WASD + J/K');
    fireEvent.click(screen.getByRole('button', { name: /经典 WASD \+ J\/K/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const savedSettings = onSaved.mock.calls[0][0];
    expect(savedSettings.keyboardMappings[1].up).toBe('KeyW');
    expect(savedSettings.keyboardMappings[1].a).toBe('KeyK');
    expect(savedSettings.keyboardMappings[1].b).toBe('KeyJ');
    s.unmount();

    // ImportDialog single-ROM immediate launch CTA
    window.history.replaceState(null, '', '#/');
    const onClose = vi.fn();
    render(<ImportDialog onClose={onClose} onImported={() => {}} onNas={() => {}}/>);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([0x4e, 0x45, 0x53, 0x1a])], 'contra.nes')] } });
    fireEvent.click(screen.getByRole('button', { name: '导入 1 张卡带' }));
    const playNow = await screen.findByRole('button', { name: '立即试玩' });
    fireEvent.click(playNow);
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(currentRoute()).toEqual({ page: 'player', id: fixtureGame.id }));
  });

  it('supports PlayerPage quick display popover, save thumbnail upload, and Game Genie dialog', async () => {
    const thumbPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const savedRecord: SaveRecord = {
      id: 'save-1', gameId: fixtureGame.id, kind: 'state', slot: 1,
      core: 'fceumm', coreVersion: 'test-v1', romSha256: fixtureGame.sha256,
      etag: '"etag-1"', createdAt: '2026-11-25T10:00:00Z', url: '/api/saves/save-1', size: 12,
    };
    let thumbUploaded = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url, window.location.origin).pathname;
      if (path === `/api/games/${fixtureGame.id}`) return json(fixtureGame);
      if (path === `/api/games/${fixtureGame.id}/launch`) return json({ romUrl: '/roms/test.nes' });
      if (path === '/roms/test.nes') return new Response(new Uint8Array(16 + 32768).fill(0x4e, 0, 1), { status: 200 });
      if (path === '/api/saves' && (!init.method || init.method === 'GET')) return json([]);
      if (path === '/api/saves' && init.method === 'POST') return json(savedRecord, 201);
      if (path === '/api/saves/save-1/thumb' && init.method === 'PUT') {
        thumbUploaded = true;
        return json({ ...savedRecord, thumbUrl: '/api/saves/save-1/thumb?v=abc123' });
      }
      if (path === '/api/settings' && init.method === 'PUT') return json({ ok: true });
      throw new Error(`Unexpected ${init.method || 'GET'} ${path}`);
    }));

    const setRamCheats = vi.fn();
    boundary.adapter = {
      ...stubAdapter(vi.fn()),
      saveState: () => new Uint8Array([1, 2, 3, 4]),
      setRamCheats,
    };
    const onSettingsChange = vi.fn();
    render(<PlayerPage id={fixtureGame.id} health={null} settings={DEFAULT_SETTINGS} onPlayed={() => {}} onSettingsChange={onSettingsChange}/>);
    await screen.findByRole('button', { name: '开始运行卡带' });

    // Quick display popover switches aspect ratio live
    fireEvent.click(screen.getByRole('button', { name: '画面显示设置' }));
    fireEvent.click(screen.getByRole('button', { name: '8:7 像素' }));
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ aspectRatio: 'pixel' }));

    // Save slot captures and uploads PNG thumbnail when canvas.toBlob is available
    const canvas = document.querySelector('canvas')!;
    canvas.toBlob = (cb) => cb(new Blob([thumbPng], { type: 'image/png' }));
    fireEvent.click(screen.getByRole('button', { name: '保存进度' }));
    await waitFor(() => expect(thumbUploaded).toBe(true));
    await screen.findByAltText('槽位 1 存档画面预览');

    // Cheats dialog adds RAM lock and applies immediately
    fireEvent.click(screen.getByRole('button', { name: '金手指' }));
    await screen.findByRole('dialog', { name: '金手指（Game Genie / 内存锁）' });
    fireEvent.change(screen.getByPlaceholderText(/SLXPLOVS/), { target: { value: '0032:1E' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect(setRamCheats).toHaveBeenCalledWith([{ address: 0x0032, value: 0x1e }]);
  });
});
