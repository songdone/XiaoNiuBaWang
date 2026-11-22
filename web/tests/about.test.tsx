import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AboutDialog } from '../src/components/AboutDialog';
import { api } from '../src/api/client';
import { downloadBytes } from '../src/api/download';

vi.mock('../src/api/download', () => ({ downloadBytes: vi.fn() }));
const assets = [
  { kind: 'wechat', label: '微信支持', url: '/support-assets/wechat-6uos.jpg' },
  { kind: 'alipay', label: '支付宝支持', url: '/support-assets/alipay-6uos.jpg' },
];
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('confirmed appreciation images', () => {
  it('shows both original images eagerly with separate enlarge links', async () => {
    vi.spyOn(api, 'supportAssets').mockResolvedValue(assets);
    render(<AboutDialog version="0.1.0" onClose={vi.fn()}/>);
    const wechat = await screen.findByRole('img', { name: '微信支持' });
    expect(wechat.getAttribute('src')).toBe(assets[0].url);
    expect(wechat.getAttribute('loading')).toBe('eager');
    expect(screen.getByRole('img', { name: '支付宝支持' }).getAttribute('src')).toBe(assets[1].url);
    for (const asset of assets) {
      const link = screen.getByRole('link', { name: `放大${asset.label}` });
      expect(link.getAttribute('href')).toBe(asset.url);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(screen.queryByText('赞赏码尚未配置')).toBeNull();
  });
  it('downloads the exact selected original bytes', async () => {
    vi.spyOn(api, 'supportAssets').mockResolvedValue(assets);
    const bytes = new Uint8Array([255, 216, 255, 0, 7, 19]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'Content-Type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AboutDialog version="0.1.0" onClose={vi.fn()}/>);
    const image = await screen.findByRole('img', { name: '支付宝支持' });
    fireEvent.click(within(image.closest('figure')!).getByRole('button', { name: '保存原图' }));
    await waitFor(() => expect(downloadBytes).toHaveBeenCalledWith(bytes, 'alipay-赞赏码原图.jpg', 'image/jpeg'));
    expect(fetchMock).toHaveBeenCalledWith(assets[1].url, { credentials: 'same-origin' });
  });
  it('reports a failed original download without substituting content', async () => {
    vi.spyOn(api, 'supportAssets').mockResolvedValue(assets);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not an image', { status: 404 })));
    render(<AboutDialog version="0.1.0" onClose={vi.fn()}/>);
    const image = await screen.findByRole('img', { name: '微信支持' });
    fireEvent.click(within(image.closest('figure')!).getByRole('button', { name: '保存原图' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(downloadBytes).not.toHaveBeenCalled();
  });
  it('does not hide an image failure behind an unconfigured message', async () => {
    vi.spyOn(api, 'supportAssets').mockResolvedValue(assets);
    render(<AboutDialog version="0.1.0" onClose={vi.fn()}/>);
    fireEvent.error(await screen.findByRole('img', { name: '微信支持' }));
    fireEvent.error(screen.getByRole('img', { name: '支付宝支持' }));
    expect(screen.queryByText('赞赏码尚未配置')).toBeNull();
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
  it('retries unavailable approved images without claiming they were never configured', async () => {
    vi.spyOn(api, 'supportAssets').mockRejectedValueOnce(new Error('内置赞赏码暂时无法读取。')).mockResolvedValueOnce(assets);
    render(<AboutDialog version="0.3.0" onClose={vi.fn()}/>);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('赞赏码尚未配置')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('img', { name: '微信支持' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '支付宝支持' })).toBeTruthy();
  });
  it('keeps the explicit source-build disabled state truthful', async () => {
    vi.spyOn(api, 'supportAssets').mockResolvedValue([]);
    render(<AboutDialog version="0.1.0" onClose={vi.fn()}/>);
    expect(await screen.findByText('赞赏码尚未配置')).toBeTruthy();
  });
});
