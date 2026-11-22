import { useEffect, useRef } from 'react';
import { APP_NAME, type Game, type LibraryCategory, type LibrarySort, type LibraryView } from '../types';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorNotice, Loading } from '../components/States';
import { CartridgeArt } from '../components/CartridgeArt';
import { Pagination } from '../components/Pagination';
import { VirtualGameList } from '../components/VirtualGameList';
import type { LibraryQueryState } from '../hooks/useLibraryQuery';
import { formatSize, gameLanguageLabel, relativeDate } from '../format';
import { navigate } from '../hooks/useRoute';

const titles: Record<LibraryView, { title: string; intro: string }> = {
  all: { title: '我的卡带库', intro: '游戏与学习，从一张卡带开始。' },
  favorites: { title: '我的收藏', intro: '喜欢的卡带，留在手边。' },
  recent: { title: '最近游玩', intro: '接着上一次的进度，继续。' },
};
export function LibraryPage({ query, onImport, onFavorite, pendingFavorite }: {
  query: LibraryQueryState; onImport: () => void; onFavorite: (game: Game) => Promise<void>; pendingFavorite: string | null;
}) {
  const { preferences, result, loading, error, change, refresh: onRetry } = query;
  const { search, sort, layout, category, view, page, pageSize } = preferences;
  const games = pageSize === 'all' ? result?.games ?? [] : (result?.games ?? []).slice(0, pageSize);
  const positionKey = `${page}:${pageSize}:${view}:${category}:${sort}:${search}`;
  const previousPosition = useRef(positionKey);
  useEffect(() => {
    if (previousPosition.current !== positionKey) { window.scrollTo(0, 0); previousPosition.current = positionKey; }
  }, [positionKey]);
  const renderGame = (game: Game, index: number) => <article className="game-card" key={game.id} data-game-index={index}>
    <button className="game-card-open" onClick={() => void navigate('game', game.id)} aria-label={`查看 ${game.title}`}><CartridgeArt game={game}/></button>
    <div className="game-card-content"><div className="game-card-meta"><span className="tag">{game.keyboard ? '学习卡带' : game.system}</span><span>{game.source === 'bundled' ? '内置' : '已导入'}</span></div><h3><button onClick={() => void navigate('game', game.id)}>{game.title}</button></h3>{game.language && <span className="game-language">{gameLanguageLabel(game)}</span>}<p>{relativeDate(game.lastPlayedAt)} <span>·</span> {formatSize(game.size)}</p><div className="game-card-actions"><button className="text-button" onClick={() => void navigate('player', game.id)}><Icon name="play" size={15}/>启动卡带</button><button className={`icon-button favorite-button${game.favorite ? ' favorited' : ''}`} aria-label={`${game.favorite ? '取消收藏' : '收藏'} ${game.title}`} aria-pressed={game.favorite} disabled={pendingFavorite === game.id} onClick={() => void onFavorite(game)}><Icon name="heart" size={18}/></button></div></div>
  </article>;
  return <div className="library-page">
    <div className="page-title-row"><div><div className="eyebrow">{APP_NAME} · NES</div><h1>{titles[view].title}</h1><p>{titles[view].intro}</p></div><button className="button primary page-import" onClick={onImport}><Icon name="plus"/>导入游戏</button></div>
    <div className="library-toolbar">
      <label className="search-field"><Icon name="search"/><span className="sr-only">搜索卡带名称或文件名</span><input type="search" placeholder="搜索卡带名称、文件名…" value={search} onChange={(event) => change({ search: event.target.value })}/>{search && <button className="icon-button" aria-label="清空搜索" onClick={() => change({ search: '' })}><Icon name="close" size={16}/></button>}</label>
      <div className="toolbar-controls"><label className="sort-field"><span className="sr-only">卡带排序</span><select value={view === 'recent' ? 'recent' : sort} onChange={(event) => change({ sort: event.target.value as LibrarySort })} disabled={view === 'recent'}><option value="added">最近导入</option><option value="title">名称排序</option><option value="recent">最近游玩</option></select></label><div className="layout-toggle" aria-label="显示方式"><button className={`icon-button${layout === 'grid' ? ' active' : ''}`} aria-label="网格显示" aria-pressed={layout === 'grid'} onClick={() => change({ layout: 'grid' })}><Icon name="library" size={18}/></button><button className={`icon-button${layout === 'list' ? ' active' : ''}`} aria-label="列表显示" aria-pressed={layout === 'list'} onClick={() => change({ layout: 'list' })}><Icon name="list" size={19}/></button></div></div>
    </div>
    <div className="category-tabs" aria-label="卡带类型">{([{ value: 'all', label: '全部类型' }, { value: 'game', label: '游戏卡带' }, { value: 'learning', label: '学习卡带' }] as { value: LibraryCategory; label: string }[]).map((item) => <button key={item.value} className={category === item.value ? 'active' : ''} aria-pressed={category === item.value} onClick={() => change({ category: item.value })}>{item.label}</button>)}</div>
    <div className="library-section-heading"><h2>{view === 'all' ? '全部卡带' : view === 'favorites' ? '收藏卡带' : '游玩记录'} <span>{result?.total ?? '—'}</span></h2><button className="text-button" onClick={onRetry}><Icon name="refresh" size={15}/>刷新</button></div>
    <Pagination query={query} position="top"/>
    {error && <ErrorNotice message={error} onRetry={onRetry}/>}
    <div className="library-results" aria-busy={loading}>
      {loading && games.length === 0 ? <Loading label={pageSize === 'all' ? '正在分批读取全部卡带…' : '正在读取卡带库…'}/> : games.length === 0 ? <EmptyState
        icon={error ? 'warning' : search || category !== 'all' ? 'search' : view === 'favorites' ? 'heart' : view === 'recent' ? 'clock' : 'cartridge'}
        title={error ? '卡带库暂时无法读取' : query.allStatus === 'cancelled' ? '已取消加载' : search || category !== 'all' ? '没有找到这张卡带' : view === 'favorites' ? '还没有收藏的卡带' : view === 'recent' ? '还没有游玩记录' : '第一张卡带，从这里开始'}
        description={error ? '连接恢复后刷新，即可继续访问你的游戏。' : query.allStatus === 'cancelled' ? '全部卡带尚未读取完成，可重新加载或选择每页条数。' : search || category !== 'all' ? '试试其他名称或类型，或清空筛选查看所有卡带。' : view === 'favorites' ? '点一下卡带旁的心形按钮，就能在这里找到它。' : view === 'recent' ? '成功启动过的卡带会出现在这里。' : '导入自己拥有使用权的 NES 卡带文件，建立自己的游戏与学习收藏。'}
        action={error ? '重新读取' : search || category !== 'all' ? '清空筛选' : view === 'all' && query.allStatus !== 'cancelled' ? '导入游戏' : undefined}
        onAction={error ? onRetry : search || category !== 'all' ? () => change({ search: '', category: 'all' }) : onImport}/>
        : pageSize === 'all' ? <VirtualGameList games={games} layout={layout} renderGame={renderGame}/>
          : <div className={`game-${layout}`}>{games.map(renderGame)}</div>}
    </div>
    <Pagination query={query} position="bottom"/>
    {!loading && !error && result?.stats.total === 0 && <div className="library-footnote"><Icon name="folder" size={18}/><p>卡带保存在你的服务器中。支持情况由已安装的核心和卡带格式决定。</p></div>}
  </div>;
}
