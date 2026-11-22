import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, normalizeGame } from '../src/api/client';
import { apiHeaders, configureCsrf, gatewayBase, sameOriginUrl } from '../src/api/urls';
import { DEFAULT_SETTINGS, type SaveRecord } from '../src/types';
import { assertSaveCompatible } from '../src/emulator/saves';
import { gameLanguageLabel } from '../src/format';

const game = normalizeGame({ id: 'actual-rom', title: '中文名称 · Original', originalTitle: 'Original', language: 'en', filename: 'actual.nes', sha256: 'a'.repeat(64), source: 'bundled', coverUrl: '/games/screenshots/actual.png' })!;
const save: SaveRecord = { id: 'saved', gameId: game.id, kind: 'state', slot: 1, createdAt: null, url: null, etag: '"saved-1-hash"', core: 'fceumm', coreVersion: '1.0', romSha256: game.sha256, size: 3 };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); configureCsrf('X-XNBW-CSRF', ''); history.replaceState(null, '', '/'); });
describe('real API boundary', () => {
  it('resolves gateway paths, preserves local screenshots and rejects foreign runtime assets', () => {
    expect(gatewayBase('/app/xiaoniubawang/')).toBe('/app/xiaoniubawang');
    history.replaceState(null, '', '/app/xiaoniubawang/');
    expect(sameOriginUrl('/api/games')).toBe('/app/xiaoniubawang/api/games');
    expect(sameOriginUrl('/app/xiaoniubawang/api/games')).toBe('/app/xiaoniubawang/api/games');
    expect(sameOriginUrl('https://other.example/core.js')).toBeNull();
    expect(game.coverUrl).toBe('/games/screenshots/actual.png');
  });
  it('prioritizes Chinese title and labels English ROM honestly', () => {
    expect(game.title).toBe('中文名称'); expect(game.originalTitle).toBe('Original');
    expect(game.source).toBe('bundled'); expect(game.readOnly).toBe(true);
    expect(gameLanguageLabel(game)).toBe('英文原版');
    expect(gameLanguageLabel({ language: 'und', translationStatus: '' })).toBe('语言未标注');
  });
  it('negotiates CSRF and uses singular file import without discarding unknown settings', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ ok: true, csrfHeader: 'X-XNBW-CSRF', csrfToken: 'fixture-token' })).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ customFutureSetting: 42, touchSize: 4 }));
    vi.stubGlobal('fetch', fetch);
    await api.health(); expect(apiHeaders().get('X-XNBW-CSRF')).toBe('fixture-token');
    await api.importGame(new File(['NES'], 'real.nes'), '真实卡带');
    const init = fetch.mock.calls[1][1] as RequestInit;
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    expect((init.body as FormData).get('files')).toBeNull();
    expect((init.body as FormData).get('title')).toBe('真实卡带');
    expect(new Headers(init.headers).get('X-XNBW-CSRF')).toBe('fixture-token');
    const settings = await api.settings(); expect(settings.customFutureSetting).toBe(42); expect(settings.touchSize).toBe(1.2);
    expect(settings.keyboardMappings).toEqual(DEFAULT_SETTINGS.keyboardMappings);
  });
  it('uses exact ETag and core assertions, returns new metadata, and keeps the snapshot on conflict', async () => {
    const snapshot = new Uint8Array([1, 2, 3]);
    const fetch = vi.fn().mockResolvedValueOnce(json({ ...save, etag: '"saved-2-hash"' })).mockResolvedValueOnce(json({ error: { code: 'save_conflict', message: 'Save conflict' } }, 412));
    vi.stubGlobal('fetch', fetch);
    const record = await api.save({ game, kind: 'state', slot: 1, core: 'fceumm', coreVersion: '1.0', bytes: snapshot, existing: save });
    expect(record.etag).toBe('"saved-2-hash"');
    const headers = new Headers(fetch.mock.calls[0][1].headers);
    expect(headers.get('If-Match')).toBe(save.etag); expect(headers.get('X-XNBW-ROM-SHA256')).toBe(game.sha256);
    await expect(api.save({ game, kind: 'state', slot: 1, core: 'fceumm', coreVersion: '1.0', bytes: snapshot, existing: save })).rejects.toBeInstanceOf(ApiError);
    expect([...snapshot]).toEqual([1, 2, 3]);
  });
  it('checks core, core version, and ROM before loading states', () => {
    expect(() => assertSaveCompatible(save, game, { name: 'FCEUmm', version: '1.0' })).not.toThrow();
    expect(() => assertSaveCompatible({ ...save, coreVersion: 'other' }, game, { name: 'FCEUmm', version: '1.0' })).toThrow('核心版本');
    expect(() => assertSaveCompatible({ ...save, romSha256: 'different' }, game, { name: 'FCEUmm', version: '1.0' })).toThrow('校验值');
  });
  it('rejects unreadable or foreign-only support responses instead of reporting unconfigured', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ assets: [{ kind: 'wechat', url: 'https://outside.example/image.jpg' }] }));
    vi.stubGlobal('fetch', fetch);
    await expect(api.supportAssets()).rejects.toThrow('赞赏码资源地址无效');
  });
  it('never manufactures QR assets and localizes server errors', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ assets: [], disabled: true })).mockResolvedValueOnce(json({ assets: [] })).mockResolvedValueOnce(json({ error: { code: 'nas_unavailable', message: 'NAS unavailable' } }, 503));
    vi.stubGlobal('fetch', fetch);
    expect(await api.supportAssets()).toEqual([]);
    await expect(api.supportAssets()).rejects.toThrow('内置赞赏码暂时无法读取');
    await expect(api.nasRoots()).rejects.toThrow('当前运行环境未提供服务器目录');
  });
});
