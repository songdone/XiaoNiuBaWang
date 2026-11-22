// Component tests exercise the real API client against controlled HTTP fixtures, not a deployed server.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { SettingsDialog, type SettingsTab } from '../src/components/SettingsDialog';
import { DEFAULT_SETTINGS, type Settings } from '../src/types';

// App wiring is tested with a player stand-in; emulator/fullscreen behavior belongs to player tests.
vi.mock('../src/pages/PlayerPage', () => ({
  PlayerPage: ({ settings, suspended, onOpenInputSettings }: { settings: Settings; suspended?: boolean; onOpenInputSettings: () => void }) => <div>
    <button onClick={onOpenInputSettings}>测试播放器按键设置</button>
    <output data-testid="player-suspended">{String(suspended)}</output>
    <output data-testid="player-settings">{JSON.stringify(settings)}</output>
  </div>,
}));

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
let fetcher: ReturnType<typeof vi.fn>;
let downloaded: Blob[];
let restoreStatus: number;
let savedStatus: number;
let writes: unknown[];
let restores: FormData[];
let backups: number;
let serverSettings: unknown;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function setup(initialTab?: SettingsTab) {
  const onClose = vi.fn(); const onSaved = vi.fn(); const onRestored = vi.fn();
  const view = render(<SettingsDialog initialTab={initialTab} onClose={onClose} onSaved={onSaved} onRestored={onRestored}/>);
  if (initialTab === 'input') await screen.findByLabelText('屏幕手柄');
  else if (initialTab === 'backup') await screen.findByRole('button', { name: '下载备份' });
  else await screen.findByLabelText('像素画面');
  return { ...view, onClose, onSaved, onRestored };
}
beforeEach(() => {
  window.history.replaceState(null, '', '/'); sessionStorage.clear(); downloaded = []; restoreStatus = 200; savedStatus = 204; writes = []; restores = []; backups = 0; serverSettings = DEFAULT_SETTINGS;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((blob: Blob) => { downloaded.push(blob); return 'blob:backup'; }) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url, window.location.origin).pathname;
    if (path === '/api/settings' && init.method === 'PUT') { const saved = JSON.parse(init.body as string); writes.push(saved); if (savedStatus === 204) serverSettings = saved; return savedStatus === 204 ? new Response(null, { status: 204 }) : json({ error: '设置保存失败' }, savedStatus); }
    if (path === '/api/settings') return json(serverSettings);
    if (path === '/api/health') return json({ ok: true });
    if (path === '/api/library') return json({ games: [], total: 0, page: 1, pageSize: 20, totalPages: 1, rangeStart: 0, rangeEnd: 0, stats: { total: 0, favorites: 0, recent: 0 } });
    if (path === '/api/backup') { backups++; return new Response(new Uint8Array([80, 75, 3, 4]), { headers: { 'Content-Type': 'application/zip' } }); }
    if (path === '/api/backup/restore') {
      restores.push(init.body as FormData);
      return restoreStatus === 200 ? json({ importedGames: 1, existingGames: 2, restoredSaves: 3, settingsRestored: true, conflicts: [{ id: 'state-1', kind: 'save', message: '已有存档已保留' }] }) : json({ error: '备份恢复失败' }, restoreStatus);
    }
    throw new Error(`Unhandled settings fixture ${path}`);
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Settings components — controlled HTTP fixtures, not deployment E2E', () => {
  it('opens input settings directly and saves the whole normalized settings without changing other fields', async () => {
    const futureSetting = { enabled: true };
    serverSettings = { ...DEFAULT_SETTINGS, pixelated: false, crt: true, aspectRatio: 'pixel', volume: 2, touchOpacity: 0.1, futureSetting };
    const view = await setup('input');
    expect(screen.getByRole('button', { name: '按键与触屏' }).classList.contains('active')).toBe(true);
    expect(screen.queryByLabelText('像素画面')).toBeNull();
    expect(screen.queryByRole('button', { name: '下载备份' })).toBeNull();
    fireEvent.click(screen.getByLabelText('屏幕手柄'));
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    const expected = { ...DEFAULT_SETTINGS, pixelated: false, crt: true, aspectRatio: 'pixel', volume: 1, touchOpacity: 0.3, showTouchControls: false, futureSetting };
    await waitFor(() => expect(view.onSaved).toHaveBeenCalledWith(expected));
    expect(writes).toEqual([expected]); expect(view.onClose).toHaveBeenCalledTimes(1);
  });
  it('keeps the standard default on general settings after a previous input dialog', async () => {
    const input = await setup('input'); input.unmount();
    await setup();
    expect(screen.getByRole('button', { name: '画面与声音' }).classList.contains('active')).toBe(true);
    expect(screen.queryByLabelText('屏幕手柄')).toBeNull();
    expect(screen.queryByRole('button', { name: '下载备份' })).toBeNull();
  });
  it('wires the player shortcut to input, suspends while open, applies whole saved settings, and resets standard entry points', async () => {
    window.history.replaceState(null, '', '/#/play/settings-test');
    const futureSetting = { enabled: true };
    serverSettings = { ...DEFAULT_SETTINGS, pixelated: false, volume: 2, futureSetting };
    render(<App/>);
    await waitFor(() => expect(JSON.parse(screen.getByTestId('player-settings').textContent!)).toEqual({ ...DEFAULT_SETTINGS, pixelated: false, volume: 1, futureSetting }));
    expect(screen.getByTestId('player-suspended').textContent).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '测试播放器按键设置' }));
    await screen.findByLabelText('屏幕手柄');
    expect(screen.getByRole('button', { name: '按键与触屏' }).classList.contains('active')).toBe(true);
    expect(screen.getByTestId('player-suspended').textContent).toBe('true');
    fireEvent.click(screen.getByLabelText('屏幕手柄'));
    expect(screen.getByTestId('player-suspended').textContent).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const expected = { ...DEFAULT_SETTINGS, pixelated: false, volume: 1, showTouchControls: false, futureSetting };
    expect(writes).toEqual([expected]);
    expect(JSON.parse(screen.getByTestId('player-settings').textContent!)).toEqual(expected);
    expect(screen.getByTestId('player-suspended').textContent).toBe('false');
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: '使用设置' }));
    await screen.findByLabelText('像素画面');
    expect(screen.getByRole('button', { name: '画面与声音' }).classList.contains('active')).toBe(true);
    expect(screen.getByTestId('player-suspended').textContent).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByTestId('player-suspended').textContent).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '测试播放器按键设置' }));
    await screen.findByLabelText('屏幕手柄');
    fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }));
    fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: '使用设置' }));
    await screen.findByLabelText('像素画面');
    expect(screen.getByRole('button', { name: '画面与声音' }).classList.contains('active')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(writes).toEqual([expected]);
    expect(screen.getByTestId('player-suspended').textContent).toBe('false');
  });
  it('saves changed general settings and custom bindings using real PUT payload', async () => {
    const view = await setup(); fireEvent.click(screen.getByLabelText('像素画面'));
    fireEvent.click(screen.getByRole('button', { name: '按键与触屏' }));
    fireEvent.click(screen.getByRole('button', { name: /设置玩家 1 的A按键/ }));
    fireEvent.keyDown(window, { code: 'KeyJ', key: 'j' });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(view.onSaved).toHaveBeenCalledTimes(1));
    expect(writes).toHaveLength(1); expect(writes[0]).toEqual({ ...DEFAULT_SETTINGS, pixelated: false, keyboardMappings: { ...DEFAULT_SETTINGS.keyboardMappings, 1: { ...DEFAULT_SETTINGS.keyboardMappings[1], a: 'KeyJ' } } });
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });
  it('keeps dialog/draft on save failure and retries; same-turn duplicate submissions do not overlap', async () => {
    savedStatus = 503; const view = await setup(); fireEvent.click(screen.getByLabelText('显像管效果'));
    const form = view.container.querySelector('form')!;
    await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(writes).toHaveLength(1); expect(view.onSaved).not.toHaveBeenCalled(); expect(view.onClose).not.toHaveBeenCalled(); expect(screen.getByText('设置保存失败')).toBeDefined();
    savedStatus = 204; fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(view.onSaved).toHaveBeenCalledTimes(1)); expect(writes[1]).toEqual({ ...DEFAULT_SETTINGS, crt: true });
  });
  it('downloads binary backup and restores selected file only after explicit confirmation', async () => {
    const view = await setup(); fireEvent.click(screen.getByRole('button', { name: '备份与恢复' }));
    fireEvent.click(screen.getByRole('button', { name: '下载备份' })); await waitFor(() => expect(downloaded).toHaveLength(1)); expect(backups).toBe(1); expect(downloaded[0].type).toBe('application/zip'); expect(downloaded[0].size).toBe(4);
    const file = new File([new Uint8Array([80, 75])], '合法备份.zip', { type: 'application/zip' });
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    expect(restores).toHaveLength(0); fireEvent.click(screen.getByRole('button', { name: '恢复此备份' }));
    await screen.findByText('备份恢复完成'); expect(restores).toHaveLength(1); expect((restores[0].get('file') as File).name).toBe('合法备份.zip'); expect(view.onRestored).toHaveBeenCalledTimes(1); expect(screen.getByText('已有存档已保留')).toBeDefined(); expect(view.onClose).not.toHaveBeenCalled();
  });
  it('restore failure keeps selected file for retry and never calls success callback', async () => {
    restoreStatus = 503; const view = await setup(); fireEvent.click(screen.getByRole('button', { name: '备份与恢复' }));
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['PK'], '备份.zip')] } });
    fireEvent.click(screen.getByRole('button', { name: '恢复此备份' })); await screen.findByText('备份恢复失败');
    expect(view.onRestored).not.toHaveBeenCalled(); expect(screen.getByText('备份.zip')).toBeDefined();
    restoreStatus = 200; fireEvent.click(screen.getByRole('button', { name: '恢复此备份' })); await screen.findByText('备份恢复完成'); expect(restores).toHaveLength(2);
  });
  it('busy backup blocks settings save, restore and dismissal until network finishes', async () => {
    const view = await setup(); const pending = deferred<Response>();
    fetcher.mockImplementationOnce(() => pending.promise);
    fireEvent.click(screen.getByRole('button', { name: '备份与恢复' })); fireEvent.click(screen.getByRole('button', { name: '下载备份' }));
    expect((screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '选择备份文件' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '关闭对话框' })); expect(view.onClose).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(new Response(new Uint8Array([80, 75]))); });
    expect((screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
