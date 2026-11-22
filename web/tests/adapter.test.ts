import { describe, expect, it, vi } from 'vitest';
import { coreVersionIdentifier, createAdapter } from '../src/emulator/adapter';

describe('explicit local core adapter', () => {
  it('derives an exact machine core version from upstream commit and keyboard patch', () => {
    const raw = 'FCEUmm 77468e568d9fe9c48d684ca911f1a3fe7259fdf7 + XiaoNiuBaWang keyboard bridge 1';
    const version = coreVersionIdentifier(raw);
    expect(version).toBe('fceumm-77468e568d9fe9c48d684ca911f1a3fe7259fdf7+xnbw-keyboard.1');
    expect(version).toMatch(/^[A-Za-z0-9._+-]{1,96}$/);
    expect(coreVersionIdentifier(raw.replace('bridge 1', 'bridge 2'))).not.toBe(version);
    expect(coreVersionIdentifier(version)).toBe(version);
    expect(() => coreVersionIdentifier('unknown descriptive version')).toThrow('版本标识');
  });
  it('reports a missing built core without pretending to start', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
    const result = await createAdapter({ canvas: document.createElement('canvas'), signal: new AbortController().signal, onError: vi.fn() }, null);
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') expect(result.reason).toContain('没有已构建');
    vi.unstubAllGlobals();
  });
  it('uses Chinese unavailable copy even when server descriptor contains English', async () => {
    const result = await createAdapter({ canvas: document.createElement('canvas'), signal: new AbortController().signal, onError: vi.fn() }, { available: false, reason: 'Not installed' });
    expect(result).toEqual({ status: 'unavailable', reason: '此安装包尚未包含可运行的 NES 模拟器核心。' });
  });
});
