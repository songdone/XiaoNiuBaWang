// Controlled paginated HTTP fixtures exercise the real client; these are not deployed-server evidence.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { api, normalizeGame } from '../src/api/client';
import { LIBRARY_PREFERENCES_KEY, useLibraryQuery } from '../src/hooks/useLibraryQuery';
import { LibraryPage } from '../src/pages/LibraryPage';
import { registerNavigationGuard } from '../src/hooks/useRoute';
import { VirtualGameList } from '../src/components/VirtualGameList';
import { DEFAULT_SETTINGS } from '../src/types';

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const makeGames = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `g-${index + 1}`, title: `卡带 ${String(index + 1).padStart(4, '0')}`, filename: `${index + 1}.nes`, tags: index === 124 ? ['跨页 %_ ÄBC'] : [], favorite: index < 21, lastPlayedAt: index < 9 ? '2026-11-21T00:00:00Z' : null, category: index < 15 ? 'learning' : 'game', keyboard: index < 15, source: 'imported', system: 'NES', importedAt: `2026-11-21T00:00:00Z` }));
let catalog = makeGames(135);
let requests: { url: URL; init: RequestInit }[];
let active: number;
let maximumActive: number;
let fetcher: ReturnType<typeof vi.fn>;
let interceptor: ((url: URL, init: RequestInit) => Promise<Response> | undefined) | null;
function responseFor(url: URL) {
  const params = url.searchParams;
  let games = catalog.filter((game) => (params.get('view') !== 'favorites' || game.favorite) && (params.get('view') !== 'recent' || !!game.lastPlayedAt));
  const category = params.get('category');
  games = games.filter((game) => !category || category === 'all' || game.category === category);
  const search = (params.get('search') || '').toLocaleLowerCase();
  games = games.filter((game) => !search || [game.title, game.filename, ...game.tags].some((value) => value.toLocaleLowerCase().includes(search)));
  // Deliberately do not sort: component must retain whatever ordering the server returned.
  const total = games.length; const pageSize = Number(params.get('pageSize'));
  const totalPages = Math.max(1, Math.ceil(total / pageSize)); const page = Math.min(Number(params.get('page')), totalPages);
  const entries = games.slice((page - 1) * pageSize, page * pageSize);
  return { games: entries, total, page, pageSize, totalPages, rangeStart: total ? (page - 1) * pageSize + 1 : 0, rangeEnd: total ? (page - 1) * pageSize + entries.length : 0, stats: { total: catalog.length, favorites: catalog.filter((game) => game.favorite).length, recent: catalog.filter((game) => game.lastPlayedAt).length } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function Harness() {
  const query = useLibraryQuery();
  return <><button onClick={() => query.change({ view: 'favorites' })}>筛选收藏</button><button onClick={() => query.change({ view: 'recent' })}>筛选最近</button><LibraryPage query={query} onImport={vi.fn()} onFavorite={async () => query.refresh()} pendingFavorite={null}/></>;
}
const top = () => within(screen.getByRole('navigation', { name: '顶部分页' }));
const bottom = () => within(screen.getByRole('navigation', { name: '底部分页' }));
const pageRequests = () => requests.filter(({ url }) => url.pathname === '/api/library');
async function ready(range = '1–20 / 共 135 条') { await waitFor(() => expect(top().getByText(range)).toBeDefined()); }
function jump(page: string, position = top()) { fireEvent.change(position.getByLabelText('跳至页码'), { target: { value: page } }); fireEvent.submit(position.getByLabelText('跳至页码').closest('form')!); }

beforeEach(() => {
  cleanup(); sessionStorage.clear(); history.replaceState(null, '', '/'); catalog = makeGames(135); requests = []; active = 0; maximumActive = 0; interceptor = null;
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
  fetcher = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, window.location.origin); requests.push({ url, init });
    const intercepted = interceptor?.(url, init); if (intercepted) return intercepted;
    if (url.pathname === '/api/library') {
      active++; maximumActive = Math.max(maximumActive, active);
      await Promise.resolve(); active--; return json(responseFor(url));
    }
    if (url.pathname === '/api/health') return json({ ok: true, version: '0.1.0' });
    if (url.pathname === '/api/settings') return json({ ...DEFAULT_SETTINGS, futureSetting: 'keep' });
    if (url.pathname === '/api/saves') return json([]);
    const favorite = url.pathname.match(/^\/api\/games\/([^/]+)\/favorite$/);
    if (favorite) { catalog = catalog.map((game) => game.id === favorite[1] ? { ...game, favorite: JSON.parse(init.body as string).favorite } : game); return new Response(null, { status: 204 }); }
    const detail = url.pathname.match(/^\/api\/games\/([^/]+)$/);
    if (detail) return json(catalog.find((game) => game.id === detail[1]));
    throw new Error(`Unexpected pagination fixture ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('pagination — real client, controlled HTTP fixtures', () => {
  it('defaults to 20 and keeps top/bottom ranges, unique IDs and server order on pages 2 and 7', async () => {
    render(<Harness/>); await ready(); expect(screen.getAllByRole('article')).toHaveLength(20);
    expect(pageRequests()).toHaveLength(1); expect(pageRequests()[0].url.searchParams.get('paginated')).toBe('1');
    const ids = Array.from(document.querySelectorAll('.pagination input,.pagination select')).map((element) => element.id); expect(new Set(ids).size).toBe(ids.length);
    fireEvent.click(top().getByRole('button', { name: '下一页' })); await ready('21–40 / 共 135 条');
    expect(bottom().getByText('第 2 / 7 页')).toBeDefined(); expect(screen.getAllByRole('article')[0].textContent).toContain('卡带 0021');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    fireEvent.click(bottom().getByRole('button', { name: '尾页' })); await ready('121–135 / 共 135 条');
    expect(top().getByText('第 7 / 7 页')).toBeDefined(); expect(screen.getAllByRole('article')).toHaveLength(15);
    expect((bottom().getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(true);
    jump('2', bottom()); await ready('21–40 / 共 135 条'); expect((top().getByLabelText('跳至页码') as HTMLInputElement).value).toBe('2');
    jump('8'); expect(top().getByRole('alert').textContent).toContain('1–7'); expect(pageRequests()).toHaveLength(4);
  });
  it('requires explicit valid custom size application and cancellation retains committed size', async () => {
    render(<Harness/>); await ready(); jump('7'); await ready('121–135 / 共 135 条');
    fireEvent.change(top().getByLabelText('每页'), { target: { value: 'custom' } });
    expect(top().getByText('1–500 条，整数')).toBeDefined();
    for (const value of ['0', '501', '1.5', '-2', '1e2', '文字', '']) {
      fireEvent.change(top().getByLabelText('每页条数'), { target: { value } }); fireEvent.click(top().getByRole('button', { name: '应用' }));
      expect(top().getByRole('alert').textContent).toBe('请输入 1–500 的整数。');
    }
    expect(pageRequests()).toHaveLength(2); fireEvent.click(top().getByRole('button', { name: '取消' })); expect(top().queryByLabelText('每页条数')).toBeNull();
    fireEvent.change(bottom().getByLabelText('每页'), { target: { value: 'custom' } }); fireEvent.change(bottom().getByLabelText('每页条数'), { target: { value: '37' } }); fireEvent.submit(bottom().getByLabelText('每页条数').closest('form')!);
    await ready('1–37 / 共 135 条'); expect((top().getByLabelText('每页') as HTMLSelectElement).selectedOptions[0].textContent).toBe('37 条（自定义）'); expect(screen.getAllByRole('article')).toHaveLength(37);
    fireEvent.change(top().getByLabelText('每页'), { target: { value: 'custom' } }); expect(top().getByLabelText('每页条数')).toBeDefined(); fireEvent.click(top().getByRole('button', { name: '取消' })); expect((top().getByLabelText('每页') as HTMLSelectElement).value).toBe('37');
    fireEvent.change(top().getByLabelText('每页'), { target: { value: '100' } }); await ready('1–100 / 共 135 条'); expect(screen.getAllByRole('article')).toHaveLength(100);
  });
  it('debounces full-library search for 250 ms, resets filters and never accepts an aborted old response', async () => {
    render(<Harness/>); await ready(); jump('7'); await ready('121–135 / 共 135 条');
    const pending = deferred<Response>(); let priorSignal: AbortSignal | undefined;
    interceptor = (url, init) => { if (url.pathname === '/api/library' && url.searchParams.get('page') === '2') { priorSignal = init.signal as AbortSignal; return pending.promise; } };
    jump('2'); expect(priorSignal).toBeDefined();
    vi.useFakeTimers(); fireEvent.change(screen.getByLabelText('搜索卡带名称或文件名'), { target: { value: '跨页 %_ ÄBC' } });
    expect(priorSignal?.aborted).toBe(true); const count = pageRequests().length;
    await act(async () => { vi.advanceTimersByTime(249); }); expect(pageRequests()).toHaveLength(count);
    await act(async () => { vi.advanceTimersByTime(1); }); vi.useRealTimers(); await ready('1–1 / 共 1 条');
    expect(screen.getAllByRole('article')[0].textContent).toContain('卡带 0125'); expect(pageRequests().at(-1)!.url.searchParams.get('page')).toBe('1');
    await act(async () => pending.resolve(json({ ...responseFor(new URL('/api/library?page=2&pageSize=20', location.origin)) })));
    await ready('1–1 / 共 1 条');
    fireEvent.click(screen.getByRole('button', { name: '清空搜索' })); await ready(); jump('7'); await ready('121–135 / 共 135 条');
    fireEvent.click(screen.getByRole('button', { name: '学习卡带' })); await ready('1–15 / 共 15 条'); expect(pageRequests().at(-1)!.url.searchParams.get('page')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: '全部类型' })); await ready(); jump('7'); await ready('121–135 / 共 135 条');
    fireEvent.change(screen.getByLabelText('卡带排序'), { target: { value: 'title' } }); await ready(); expect(pageRequests().at(-1)!.url.searchParams.get('sort')).toBe('title');
    jump('7'); await ready('121–135 / 共 135 条'); fireEvent.click(screen.getByRole('button', { name: '筛选最近' })); await ready('1–9 / 共 9 条');
  });
  it('preserves committed rows and global counts on network failure and clamps a shrinking last page', async () => {
    render(<App/>); await ready(); const sidebar = within(screen.getByRole('navigation', { name: '卡带库导航' }));
    expect(sidebar.getByRole('button', { name: '全部卡带 135' })).toBeDefined(); expect(sidebar.getByRole('button', { name: '我的收藏 21' })).toBeDefined();
    jump('7'); await ready('121–135 / 共 135 条');
    interceptor = (url) => url.pathname === '/api/library' ? Promise.reject(new TypeError('offline')) : undefined;
    fireEvent.click(screen.getByRole('button', { name: '刷新' })); await screen.findByText('无法连接服务，请检查网络后重试。');
    expect(screen.getAllByRole('article')).toHaveLength(15); expect(sidebar.getByRole('button', { name: '全部卡带 135' })).toBeDefined();
    interceptor = null; catalog = catalog.slice(0, 100); fireEvent.click(screen.getByRole('button', { name: '刷新' })); await ready('81–100 / 共 100 条');
    expect(top().getByText('第 5 / 5 页')).toBeDefined(); expect(JSON.parse(sessionStorage.getItem(LIBRARY_PREFERENCES_KEY)!).page).toBe(5);
    expect(requests.some(({ url }) => url.pathname === '/api/games' || url.pathname === '/api/library' && !url.searchParams.has('paginated'))).toBe(false);
    expect(requests.filter(({ url }) => url.pathname === '/api/settings')).toHaveLength(1);
  });
  it('favorite refresh updates global stats and clamps favorites without a duplicate library request', async () => {
    render(<App/>); await ready(); fireEvent.click(screen.getByRole('button', { name: '我的收藏 21' })); await ready('1–20 / 共 21 条');
    jump('2'); await ready('21–21 / 共 21 条'); const before = pageRequests().length;
    fireEvent.click(screen.getByRole('button', { name: '取消收藏 卡带 0021' })); await ready('1–20 / 共 20 条');
    expect(screen.getByRole('button', { name: '我的收藏 20' })).toBeDefined(); expect(screen.getByRole('button', { name: '全部卡带 135' })).toBeDefined();
    expect(pageRequests()).toHaveLength(before + 1); expect(pageRequests().at(-1)!.url.searchParams.get('page')).toBe('2');
  });
  it('remembers query/layout/page/size returning from detail and remounting without settings PUTs', async () => {
    const app = render(<App/>); await ready(); fireEvent.change(top().getByLabelText('每页'), { target: { value: '50' } }); await ready('1–50 / 共 135 条');
    fireEvent.click(screen.getByRole('button', { name: '列表显示' })); jump('2'); await ready('51–100 / 共 135 条');
    fireEvent.click(screen.getByRole('button', { name: '查看 卡带 0051' })); await screen.findByRole('button', { name: '返回卡带库' });
    fireEvent.click(screen.getByRole('button', { name: '返回卡带库' })); await ready('51–100 / 共 135 条'); expect(document.querySelector('.game-list')).not.toBeNull();
    expect((top().getByLabelText('每页') as HTMLSelectElement).value).toBe('50'); expect(pageRequests()).toHaveLength(3);
    app.unmount(); render(<App/>); await ready('51–100 / 共 135 条');
    expect(pageRequests().at(-1)!.url.searchParams.get('pageSize')).toBe('50'); expect(requests.some(({ init }) => init.method === 'PUT')).toBe(false);
  });
  it('rejected navigation preserves existing view, query and sidebar counts', async () => {
    render(<App/>); await ready(); fireEvent.click(screen.getByRole('button', { name: '查看 卡带 0001' })); await screen.findByRole('button', { name: '返回卡带库' });
    const unregister = registerNavigationGuard(() => false); const count = pageRequests().length;
    try {
      await act(async () => fireEvent.click(screen.getByRole('button', { name: '我的收藏 21' })));
      expect(screen.getByRole('button', { name: '返回卡带库' })).toBeDefined(); expect(JSON.parse(sessionStorage.getItem(LIBRARY_PREFERENCES_KEY)!).view).toBe('all');
      expect(pageRequests()).toHaveLength(count); expect(screen.getByRole('button', { name: '全部卡带 135' })).toBeDefined();
    } finally { unregister(); }
  });
  it('loads all 3000 in six serial bounded requests but mounts only a window in grid and mobile list', async () => {
    catalog = makeGames(3000); render(<Harness/>); await ready('1–20 / 共 3000 条');
    fireEvent.change(top().getByLabelText('每页'), { target: { value: 'all' } }); await ready('1–3000 / 共 3000 条');
    expect(pageRequests().slice(1)).toHaveLength(6); expect(pageRequests().slice(1).every(({ url }) => url.searchParams.get('pageSize') === '500')).toBe(true); expect(maximumActive).toBe(1);
    expect(screen.getAllByRole('article').length).toBeLessThan(100); expect(screen.queryByRole('button', { name: '查看 卡带 3000' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '列表显示' })); await waitFor(() => expect(document.querySelector('.virtual-list')).not.toBeNull());
    expect(screen.getAllByRole('article').length).toBeLessThan(100); expect(pageRequests()).toHaveLength(7);
    expect((top().getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('all cancellation aborts pending batches, never shows completion and cannot overwrite a newer page', async () => {
    catalog = makeGames(3000); render(<Harness/>); await ready('1–20 / 共 3000 条');
    const pending = deferred<Response>(); let signal: AbortSignal | undefined;
    interceptor = (url, init) => {
      if (url.searchParams.get('pageSize') === '500' && url.searchParams.get('page') === '2') { signal = init.signal as AbortSignal; return pending.promise; }
    };
    fireEvent.change(top().getByLabelText('每页'), { target: { value: 'all' } }); await waitFor(() => expect(top().getByText('已加载 500 / 共 3000 条（加载中）')).toBeDefined());
    fireEvent.click(bottom().getByRole('button', { name: '取消加载' })); expect(signal?.aborted).toBe(true); expect(top().getByText('已加载 500 / 共 3000 条（已取消，未完成）')).toBeDefined();
    fireEvent.change(top().getByLabelText('每页'), { target: { value: '20' } }); await ready('1–20 / 共 3000 条');
    const count = pageRequests().length;
    await act(async () => pending.resolve(json(responseFor(new URL('/api/library?page=2&pageSize=500', location.origin)))));
    await ready('1–20 / 共 3000 条'); expect(pageRequests()).toHaveLength(count); expect(screen.getAllByRole('article')).toHaveLength(20);
  });
  it.each(['total', 'duplicate'])('stops all loading on %s drift and never labels partial data complete', async (kind) => {
    catalog = makeGames(1200); render(<Harness/>); await ready('1–20 / 共 1200 条');
    interceptor = (url) => {
      if (url.searchParams.get('pageSize') !== '500' || url.searchParams.get('page') !== '2') return;
      if (kind === 'total') { catalog = catalog.slice(0, 1100); return Promise.resolve(json(responseFor(url))); }
      const response = responseFor(url); response.games[0] = catalog[0]; return Promise.resolve(json(response));
    };
    fireEvent.change(top().getByLabelText('每页'), { target: { value: 'all' } });
    await screen.findByText(kind === 'total' ? '加载期间卡带库数量发生变化，已停止。请刷新后重新加载全部卡带。' : '加载期间发现重复卡带，已停止。请刷新后重新加载全部卡带。');
    expect(top().getByText(/未完成/)).toBeDefined(); expect(pageRequests()).toHaveLength(3);
  });
  it('all mode reads the complete 135-entry library, and a shrink clamp followed immediately by a filter still sends the new query', async () => {
    render(<Harness/>); await ready(); fireEvent.change(top().getByLabelText('每页'), { target: { value: 'all' } }); await ready('1–135 / 共 135 条');
    expect(pageRequests()).toHaveLength(2); expect(pageRequests()[1].url.searchParams.get('pageSize')).toBe('500');
    fireEvent.change(top().getByLabelText('每页'), { target: { value: '20' } }); await ready(); jump('7'); await ready('121–135 / 共 135 条');
    catalog = catalog.slice(0, 100); fireEvent.click(screen.getByRole('button', { name: '刷新' })); await ready('81–100 / 共 100 条');
    fireEvent.click(screen.getByRole('button', { name: '学习卡带' })); await ready('1–15 / 共 15 条');
    expect(pageRequests().at(-1)!.url.searchParams.get('category')).toBe('learning'); expect(pageRequests().at(-1)!.url.searchParams.get('page')).toBe('1');
  });
  it('handles empty results with page 1/1 and range zero; malformed storage and invalid API bounds are safe', async () => {
    sessionStorage.setItem(LIBRARY_PREFERENCES_KEY, '{broken'); catalog = []; render(<Harness/>); await ready('0–0 / 共 0 条');
    expect(top().getByText('第 1 / 1 页')).toBeDefined(); const count = requests.length;
    for (const size of [0, 501, 1.5]) await expect(api.libraryPage({ page: 1, pageSize: size, view: 'all', category: 'all', sort: 'added', search: '' })).rejects.toThrow('1–500');
    expect(requests).toHaveLength(count);
  });
  it('window scroll unmounts offscreen cards and tab at a window edge mounts the next accessible article', async () => {
    const games = makeGames(3000).map((game) => normalizeGame(game)!);
    const topOffset = { value: 0 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
      return { top: this.classList.contains('virtual-game-list') ? -topOffset.value : 0, width: 390, height: this.hasAttribute('data-row') ? 320 : 0, bottom: 0, left: 0, right: 390, x: 0, y: 0, toJSON: () => ({}) };
    });
    render(<VirtualGameList games={games} layout="list" renderGame={(game, index) => <article key={game.id} data-game-index={index}><button>{game.title}</button></article>}/>);
    const last = screen.getAllByRole('button').at(-1)!; const index = Number(last.closest('article')!.dataset.gameIndex);
    fireEvent.focus(last); fireEvent.keyDown(last, { key: 'Tab' }); await waitFor(() => expect(document.activeElement?.textContent).toBe(games[index + 1].title));
    fireEvent.blur(document.activeElement!); topOffset.value = 50_000; fireEvent.scroll(window);
    await waitFor(() => expect(screen.queryByText(games[0].title)).toBeNull()); expect(screen.getAllByRole('article').length).toBeLessThan(30);
  });
});
