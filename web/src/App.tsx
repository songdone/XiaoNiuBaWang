import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api/client';
import { Brand } from './components/Brand';
import { Icon } from './components/Icon';
import { ImportDialog } from './components/ImportDialog';
import { SettingsDialog, type SettingsTab } from './components/SettingsDialog';
import { AboutDialog } from './components/AboutDialog';
import { NasDialog } from './components/NasDialog';
import { LibraryPage } from './pages/LibraryPage';
import { GameDetailPage } from './pages/GameDetailPage';
import { PlayerPage } from './pages/PlayerPage';
import { navigate, useRoute } from './hooks/useRoute';
import { consumeNasReturn } from './fnos/authorization';
import { useLibraryQuery } from './hooks/useLibraryQuery';
import { APP_NAME, APP_SHORT_NAME, DEFAULT_SETTINGS, type Game, type Health, type LibraryView, type Settings } from './types';
import './styles/app.css';

export default function App() {
  const route = useRoute();
  const libraryQuery = useLibraryQuery();
  const { view } = libraryQuery.preferences;
  const [health, setHealth] = useState<Health | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [connecting, setConnecting] = useState(true);
  const [pendingFavorite, setPendingFavorite] = useState<string | null>(null);
  const [modal, setModal] = useState<'import' | 'settings' | 'about' | 'nas' | null>(() => consumeNasReturn() ? 'nas' : null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const openSettings = (tab: SettingsTab = 'general') => { setSettingsTab(tab); setModal('settings'); };
  const [toast, setToast] = useState('');
  const favoriteRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const refreshConnection = useCallback(async () => {
    requestRef.current?.abort();
    const abort = new AbortController(); requestRef.current = abort;
    setConnecting(true);
    const [healthResult, settingsResult] = await Promise.allSettled([api.health(abort.signal), api.settings(abort.signal)]);
    if (abort.signal.aborted) return;
    setHealth(healthResult.status === 'fulfilled' ? healthResult.value : null);
    if (settingsResult.status === 'fulfilled') setSettings(settingsResult.value);
    setConnecting(false);
  }, []);
  const refresh = useCallback(() => { libraryQuery.refresh(); void refreshConnection(); }, [libraryQuery.refresh, refreshConnection]);
  useEffect(() => { document.title = `${APP_NAME} · 我的卡带库`; }, []);
  useEffect(() => { void refreshConnection(); return () => requestRef.current?.abort(); }, [refreshConnection]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timeout);
  }, [toast]);
  const favorite = async (game: Game) => {
    if (favoriteRef.current) return;
    favoriteRef.current = true;
    setPendingFavorite(game.id);
    try {
      await api.favorite(game.id, !game.favorite);
      libraryQuery.refresh();
      setToast(game.favorite ? '已取消收藏' : '已加入收藏');
    } catch (cause) { setToast(errorMessage(cause)); }
    finally { favoriteRef.current = false; setPendingFavorite(null); }
  };
  const switchView = async (value: LibraryView) => { if (await navigate('library')) libraryQuery.change({ view: value }); };
  const stats = libraryQuery.result?.stats;
  const counts = { all: stats?.total ?? '—', favorites: stats?.favorites ?? '—', recent: stats?.recent ?? '—' };
  return <div className={`app-shell${route.page === 'player' ? ' player-shell' : ''}`}>
    <a href="#main-content" className="skip-link" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>跳到主要内容</a>
    <aside className="sidebar"><button className="brand-button" aria-label={`${APP_NAME}首页`} onClick={() => switchView('all')}><Brand/></button><div className="sidebar-rule"/><nav className="main-nav" aria-label="卡带库导航">{([{ value: 'all', icon: 'library', label: '全部卡带' }, { value: 'favorites', icon: 'heart', label: '我的收藏' }, { value: 'recent', icon: 'clock', label: '最近游玩' }] as const).map((item) => <button key={item.value} className={`nav-item${route.page === 'library' && view === item.value ? ' active' : ''}`} aria-current={route.page === 'library' && view === item.value ? 'page' : undefined} onClick={() => switchView(item.value)}><Icon name={item.icon}/><span>{item.label}</span><small>{counts[item.value]}</small></button>)}</nav><div className="sidebar-library"><span className="nav-section-label">卡带管理</span><button className="nav-item" onClick={() => setModal('import')}><Icon name="upload"/><span>导入卡带</span><Icon name="plus" size={16}/></button><button className="nav-item" onClick={() => setModal('nas')}><Icon name="folder"/><span>服务器目录</span></button></div><div className="sidebar-bottom"><div className="server-card"><div><span className={`status-dot${health?.online ? ' online' : ''}`}/><strong>{health?.online ? '服务已连接' : connecting ? '正在连接服务' : '服务未连接'}</strong></div><span>{health?.online ? '个人卡带库已连接' : '你的卡带，保存在自己的服务器'}</span></div><button className="nav-item" onClick={() => openSettings()}><Icon name="settings"/><span>使用设置</span></button><button className="nav-item" onClick={() => setModal('about')}><Icon name="help"/><span>关于与支持</span></button><div className="sidebar-footer"><span>{APP_SHORT_NAME}</span><span>{health?.version ? `v${health.version}` : 'NES 学习机'}</span></div></div></aside>
    <div className="app-main"><header className="topbar"><div className="desktop-breadcrumb"><span>{APP_SHORT_NAME}</span><Icon name="chevron" size={13}/><strong>{route.page === 'library' ? '卡带库' : route.page === 'game' ? '卡带详情' : '卡带播放器'}</strong></div><button className="mobile-brand brand-button" onClick={() => switchView('all')}><Brand compact/></button><div className="topbar-actions"><span className="private-label"><span className="status-dot online"/>个人空间</span><button className="icon-button" aria-label="使用设置" onClick={() => openSettings()}><Icon name="settings" size={19}/></button><button className="icon-button" aria-label="关于与支持" onClick={() => setModal('about')}><Icon name="help" size={19}/></button></div></header>
      <main id="main-content" tabIndex={-1}>{route.page === 'library' ? <LibraryPage query={libraryQuery} onImport={() => setModal('import')} onFavorite={favorite} pendingFavorite={pendingFavorite}/> : route.page === 'game' ? <GameDetailPage key={route.id} id={route.id} refreshLibrary={() => void refresh()} onFavorite={favorite} pendingFavorite={pendingFavorite}/> : <PlayerPage key={route.id} id={route.id} health={health} settings={settings} suspended={modal !== null} onOpenInputSettings={() => openSettings('input')} onPlayed={() => void refresh()}/>}</main>
      <footer className="app-footer"><span>{APP_SHORT_NAME} · 游戏与学习</span><span>NES 学习机</span></footer>
    </div>
    <nav className="mobile-nav" aria-label="移动导航"><button className={route.page === 'library' && view === 'all' ? 'active' : ''} onClick={() => switchView('all')}><Icon name="library"/><span>卡带库</span></button><button className={route.page === 'library' && view === 'favorites' ? 'active' : ''} onClick={() => switchView('favorites')}><Icon name="heart"/><span>收藏</span></button><button className={route.page === 'library' && view === 'recent' ? 'active' : ''} onClick={() => switchView('recent')}><Icon name="clock"/><span>最近</span></button><button onClick={() => setModal('import')}><Icon name="upload"/><span>导入</span></button></nav>
    {modal === 'import' && <ImportDialog onClose={() => setModal(null)} onNas={() => setModal('nas')} onImported={() => void refresh()}/>}
    {modal === 'settings' && <SettingsDialog initialTab={settingsTab} onClose={() => setModal(null)} onRestored={() => void refresh()} onSaved={(value) => { setSettings(value); setToast('设置已保存'); }}/>}
    {modal === 'nas' && <NasDialog onClose={() => setModal(null)} onImported={() => void refresh()}/>}
    {modal === 'about' && <AboutDialog version={health?.version ?? null} onClose={() => setModal(null)}/>}
    {toast && <div className="toast" role="status"><Icon name="check" size={18}/><span>{toast}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setToast('')}><Icon name="close" size={16}/></button></div>}
  </div>;
}
