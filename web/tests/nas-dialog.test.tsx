import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NasDialog } from '../src/components/NasDialog';
import { api, ApiError, type NasRootDiagnostics, type NasRoots, type ScanJob } from '../src/api/client';
import { authorizeDirectory, takeNasReturn, type AuthOutcome, type DirectoryAuthorization } from '../src/fnos/authorization';
import { NativePickerUnavailable } from '../src/fnos/native';
vi.mock('../src/fnos/authorization', () => ({ authorizeDirectory: vi.fn(), takeNasReturn: vi.fn(() => null) }));
const roots: NasRoots = { available: true, roots: [{ name: '卡带目录', path: 'nas_root', kind: 'directory' }], capabilities: { browse: true, importFiles: true, scan: true } };
const diagnostics = (extra: Partial<NasRootDiagnostics> = {}): NasRootDiagnostics => ({ authorized: 0, usable: 0, invalidPath: 0, aclDenied: 0, directoryUnreadable: 0, duplicate: 0, ...extra });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const realNasRoots = api.nasRoots;
const directory = { path: 'nas_root', root: 'nas_root', parent: null, truncated: false, entries: [{ name: '测试卡带.nes', path: 'nas_rom', kind: 'rom' as const }] };
const job = (status: ScanJob['status'], extra = {}): ScanJob => ({ id: 'job1', path: 'nas_root', status, visited: 1, discovered: 1, imported: 0, failed: 0, errors: [], startedAt: '', ...extra });
beforeEach(() => {
  sessionStorage.clear(); vi.mocked(takeNasReturn).mockReturnValue(null);
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; }); HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; });
  vi.spyOn(api, 'nasRoots').mockResolvedValue(roots); vi.spyOn(api, 'nasBrowse').mockResolvedValue(directory);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup() { const onImported = vi.fn(); const onClose = vi.fn(); render(<NasDialog onImported={onImported} onClose={onClose}/>); return { onImported, onClose }; }
async function browse() { fireEvent.click(await screen.findByRole('button', { name: '卡带目录' })); await screen.findByText('测试卡带.nes'); }
function authorization(blocked = false) {
  let resolve!: (value: AuthOutcome) => void;
  const flow: DirectoryAuthorization = { popupBlocked: blocked, result: new Promise((done) => { resolve = done; }), cancel: vi.fn(() => resolve('cancel')), continueInSameWindow: vi.fn() };
  vi.mocked(authorizeDirectory).mockReturnValue(flow); return { flow, resolve };
}
describe('NAS authorization and revoked directories UI', () => {
  it('empty roots offers in-app authorization, success refreshes and auto-browses opaque root only', async () => {
    vi.mocked(api.nasRoots).mockResolvedValueOnce({ ...roots, roots: [] }).mockResolvedValue(roots);
    const { resolve } = authorization(); setup();
    await screen.findByText('还没有已授权的目录'); fireEvent.click(screen.getByRole('button', { name: '添加卡带目录' }));
    await act(async () => resolve('success')); await screen.findByText('测试卡带.nes');
    expect(api.nasRoots).toHaveBeenCalledTimes(2); expect(api.nasBrowse).toHaveBeenCalledWith('nas_root');
    expect(document.body.textContent).not.toContain('请在飞牛应用设置');
  });
  it('blocked popup offers explicit same-window fallback; cancellation/error preserve existing directory', async () => {
    const { flow, resolve } = authorization(true); setup(); await browse();
    fireEvent.click(screen.getByRole('button', { name: '添加卡带目录' }));
    fireEvent.click(screen.getByRole('button', { name: '在当前窗口选择并授权' })); expect(flow.continueInSameWindow).toHaveBeenCalledTimes(1);
    await act(async () => resolve('cancel')); expect(screen.getByText('测试卡带.nes')).toBeTruthy(); expect(api.nasRoots).toHaveBeenCalledTimes(1);
    const next = authorization(); fireEvent.click(screen.getByRole('button', { name: '添加卡带目录' })); await act(async () => next.resolve('error')); expect(screen.getByText('目录授权未完成，请重新选择并授权。')).toBeTruthy();
  });
  it('restores same-window return and clears stale directory and checkbox on refresh', async () => {
    vi.mocked(takeNasReturn).mockReturnValue('success'); setup(); await screen.findByText('测试卡带.nes');
    fireEvent.click(screen.getByRole('checkbox')); expect(screen.getByRole('button', { name: '导入已选 1 项' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '刷新授权目录' })); await screen.findByRole('button', { name: '卡带目录' });
    expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByText('测试卡带.nes')).toBeNull();
  });
  it('410 browse or ACL revocation removes old directory/selection before refreshing', async () => {
    setup(); await browse(); fireEvent.click(screen.getByRole('checkbox'));
    vi.spyOn(api, 'nasImport').mockResolvedValue({ games: [], imported: 0, failed: [{ path: 'nas_rom', code: 'access_denied', message: '权限已撤销' }] });
    vi.mocked(api.nasRoots).mockResolvedValue({ ...roots, roots: [] }); fireEvent.click(screen.getByRole('button', { name: '导入已选 1 项' }));
    await screen.findByText('还没有已授权的目录'); expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('expired handle browse refreshes roots and never keeps a previous listing', async () => {
    vi.mocked(api.nasBrowse).mockRejectedValue(new ApiError('目录引用已失效', 410)); setup();
    fireEvent.click(await screen.findByRole('button', { name: '卡带目录' })); await waitFor(() => expect(api.nasRoots).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('native unsupported has an actual browser link, not a claimed successful authorization', async () => {
    vi.mocked(authorizeDirectory).mockImplementation(() => { throw new NativePickerUnavailable(); }); setup();
    await screen.findByRole('button', { name: '卡带目录' }); fireEvent.click(screen.getByRole('button', { name: '添加卡带目录' }));
    const link = screen.getByRole('link', { name: '在浏览器中打开本应用' }); expect(link.getAttribute('target')).toBe('_blank'); expect(api.nasRoots).toHaveBeenCalledTimes(1);
  });
});
describe('truthful scoped NAS root feedback', () => {
  function fetchRoots(value: unknown, status = 200) {
    vi.mocked(api.nasRoots).mockImplementation(realNasRoots);
    const fetch = vi.fn().mockImplementation(async () => json(value, status)); vi.stubGlobal('fetch', fetch); return fetch;
  }
  it('genuine zero diagnostics is HTTP200 authorized-empty, not unreadable', async () => {
    fetchRoots({ ...roots, roots: [], diagnostics: diagnostics() });
    const { onImported } = setup(); await screen.findByText('还没有已授权的目录');
    expect(screen.queryByText('已授权，但应用无法读取目录')).toBeNull();
    expect((screen.getByRole('button', { name: '添加卡带目录' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '刷新授权目录' })); await waitFor(() => expect(api.nasRoots).toHaveBeenCalledTimes(2)); expect(onImported).not.toHaveBeenCalled();
  });
  it.each([
    [403, 'nas_directory_unreadable', { directoryUnreadable: 1 }, '应用无法读取目录内容或访问上级目录'],
    [403, 'access_denied', { aclDenied: 1 }, '当前账号的目录读取权限未通过检查'],
    [400, 'unsafe_path', { invalidPath: 1 }, '飞牛返回的目录位置无效或不符合安全要求'],
    [200, '', { directoryUnreadable: 1 }, '应用无法读取目录内容或访问上级目录'],
  ])('retains known %s %s root failures and shows actual reason', async (status, code, detail, reason) => {
    fetchRoots({ ...roots, roots: [], diagnostics: diagnostics({ authorized: 1, ...detail }), error: { code, message: '不能访问 /vol1/private/another-user' } }, status as number);
    setup(); await screen.findByText('已授权，但应用无法读取目录');
    expect(document.body.textContent).toContain(reason); expect(document.body.textContent).toContain('重新授权或反复刷新不会自动修复读取权限');
    expect(document.body.textContent).not.toContain('/vol1'); expect(document.body.textContent).not.toContain('another-user');
    expect(screen.queryByText('还没有已授权的目录')).toBeNull(); expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
    expect((screen.getByRole('button', { name: '添加卡带目录' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('mixed valid/unreadable roots can browse and import without displaying counts or rejected paths', async () => {
    fetchRoots({ ...roots, diagnostics: diagnostics({ authorized: 1000, usable: 1, directoryUnreadable: 998, invalidPath: 1 }), rejectedPaths: ['/vol1/other-users'] });
    setup(); await browse();
    expect(document.body.textContent).toContain('部分授权目录暂不可用');
    expect(document.body.textContent).not.toMatch(/1000|998|other-users|\/vol1/);
    expect((screen.getByRole('button', { name: '扫描并导入此目录' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('successful callback with no returned folders never claims completed authorization or auto-imports', async () => {
    vi.mocked(api.nasRoots).mockResolvedValue({ ...roots, roots: [], diagnostics: diagnostics({ authorized: 1, directoryUnreadable: 1 }) });
    const scan = vi.spyOn(api, 'nasScan'); const importFiles = vi.spyOn(api, 'nasImport'); const { resolve } = authorization(); const { onImported } = setup();
    await screen.findByText('已授权，但应用无法读取目录'); fireEvent.click(screen.getByRole('button', { name: '添加卡带目录' }));
    await act(async () => resolve('success')); await screen.findByText('飞牛目录选择已返回，但服务器尚未提供可读取目录。此次操作没有导入卡带，请查看下方原因。');
    expect(api.nasRoots).toHaveBeenCalledTimes(2); expect(api.nasBrowse).not.toHaveBeenCalled(); expect(scan).not.toHaveBeenCalled(); expect(importFiles).not.toHaveBeenCalled(); expect(onImported).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('选择并授权已完成');
  });
  it('old empty responses are safely shown once and do not start a refresh loop', async () => {
    fetchRoots({ ...roots, roots: [] }); vi.mocked(takeNasReturn).mockReturnValue('success'); setup();
    await screen.findByText('还没有已授权的目录'); await screen.findByText('目录选择返回成功不代表服务器已获得可读取目录。可在飞牛目录窗口核对选择是否保存，以及账号与应用的读取权限。');
    expect(api.nasRoots).toHaveBeenCalledTimes(1); expect(api.nasBrowse).not.toHaveBeenCalled();
  });
  it.each([
    { ...roots, roots: null },
    { ...roots, diagnostics: diagnostics({ authorized: 1, usable: 1, aclDenied: -1 }) },
    { ...roots, diagnostics: diagnostics({ authorized: 2, usable: 1 }) },
    { ...roots, diagnostics: diagnostics({ authorized: 1, usable: 0, directoryUnreadable: 1 }) },
    { ...roots, roots: [{ name: '别人的目录', path: '/vol1/private/user2', kind: 'directory' }] },
  ])('invalid HTTP200 response is not displayed as no authorization', async (value) => {
    fetchRoots(value); setup(); await screen.findByText('服务器目录响应异常');
    expect(screen.queryByText('还没有已授权的目录')).toBeNull(); expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
    expect(document.body.textContent).not.toContain('/vol1'); expect(document.body.textContent).not.toContain('别人的目录');
    expect((screen.getByRole('button', { name: '添加卡带目录' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it.each([[401, 'authentication_required', '登录已过期'], [503, 'nas_unavailable', '服务器目录服务暂不可用']])('keeps %s errors without leaking roots or enabling authorization', async (status, code, title) => {
    fetchRoots({ ...roots, roots: [{ path: '/vol1/private/user2', name: '其他用户', kind: 'directory' }], error: { code } }, status as number);
    await expect(realNasRoots()).rejects.toBeInstanceOf(ApiError); setup(); await screen.findByRole('heading', { name: title as string });
    expect(document.body.textContent).not.toContain('其他用户'); expect(document.body.textContent).not.toContain('/vol1');
    expect((screen.getByRole('button', { name: '添加卡带目录' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('unclassified 403 never downgrades an authorization failure to a usable root response', async () => {
    fetchRoots({ ...roots, roots: [], diagnostics: diagnostics({ authorized: 1, directoryUnreadable: 1 }), error: { code: 'csrf_required' } }, 403);
    await expect(realNasRoots()).rejects.toBeInstanceOf(ApiError);
  });
  it('invalid roots after refresh clear the prior directory and selected references', async () => {
    const fetch = fetchRoots({ ...roots, diagnostics: diagnostics({ authorized: 1, usable: 1 }) }); setup(); await browse(); fireEvent.click(screen.getByRole('checkbox'));
    fetch.mockImplementation(async () => json({ ...roots, roots: 'invalid' })); fireEvent.click(screen.getByRole('button', { name: '刷新授权目录' }));
    await screen.findByText('服务器目录响应异常'); expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByText('测试卡带.nes')).toBeNull();
    expect((screen.getByRole('button', { name: '添加卡带目录' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('scan diagnostics never display physical paths even in Chinese failure messages', async () => {
    sessionStorage.setItem('xnbw-active-scan', 'job1');
    vi.spyOn(api, 'nasScanStatus').mockResolvedValue(job('failed', { errors: [{ path: '/vol1/private/other-user', code: 'access_denied', message: '读取 /vol1/private/other-user 失败' }] }));
    setup(); await screen.findByText('查看 1 个错误'); expect(document.body.textContent).not.toContain('/vol1'); expect(document.body.textContent).not.toContain('other-user');
  });
  it('browse failures clear unsafe error details and retain current known gateway availability', async () => {
    vi.mocked(api.nasBrowse).mockRejectedValue(new ApiError('应用不能读取 /vol1/private/another-user', 403)); setup();
    fireEvent.click(await screen.findByRole('button', { name: '卡带目录' })); await waitFor(() => expect(api.nasRoots).toHaveBeenCalledTimes(2));
    expect(document.body.textContent).not.toContain('/vol1'); expect(screen.queryByRole('checkbox')).toBeNull();
    expect((screen.getByRole('button', { name: '添加卡带目录' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('valid authorization only browses; explicit scan-import increases library via import callback', async () => {
    vi.mocked(api.nasRoots).mockResolvedValueOnce({ ...roots, roots: [], diagnostics: diagnostics() }).mockResolvedValue({ ...roots, diagnostics: diagnostics({ authorized: 1, usable: 1 }) });
    const scan = vi.spyOn(api, 'nasScan').mockResolvedValue(job('completed', { imported: 1 })); const { resolve } = authorization(); const { onImported } = setup();
    await screen.findByText('还没有已授权的目录'); fireEvent.click(screen.getByRole('button', { name: '添加卡带目录' })); await act(async () => resolve('success')); await screen.findByText('测试卡带.nes');
    const button = screen.getByRole('button', { name: '扫描并导入此目录' }); expect(button.className).toContain('primary');
    expect(document.body.textContent).toContain('刷新目录不会增加卡带库数量'); expect(scan).not.toHaveBeenCalled(); expect(onImported).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '只浏览 / 选文件导入' })); expect(document.activeElement).toBe(screen.getByRole('checkbox')); expect(scan).not.toHaveBeenCalled();
    fireEvent.click(button); await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1)); expect(scan).toHaveBeenCalledWith('nas_root');
  });
});
describe('partial scan imports refresh library', () => {
  it.each(['cancelled', 'failed'] as const)('restored %s job refreshes imported prefix once', async (status) => {
    sessionStorage.setItem('xnbw-active-scan', 'job1'); vi.spyOn(api, 'nasScanStatus').mockResolvedValue(job(status, { imported: 1 }));
    const { onImported } = setup(); await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem('xnbw-active-scan')).toBeNull();
  });
  it('cancelled running job refreshes successful prefix and allows rescan', async () => {
    vi.spyOn(api, 'nasScan').mockResolvedValue(job('running')); vi.spyOn(api, 'nasCancelScan').mockResolvedValue(job('cancelled', { imported: 1 }));
    const { onImported } = setup(); await browse(); fireEvent.click(screen.getByRole('button', { name: '扫描并导入此目录' }));
    fireEvent.click(await screen.findByRole('button', { name: '取消扫描' })); await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect((screen.getByRole('button', { name: '重新扫描并导入此目录' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('failed batch request refreshes library because prefix may already have committed', async () => {
    vi.spyOn(api, 'nasImport').mockRejectedValue(new TypeError('network')); const { onImported } = setup(); await browse(); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '导入已选 1 项' })); await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
  });
});
