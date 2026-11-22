import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { CartridgeArt } from '../components/CartridgeArt';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorNotice, Loading } from '../components/States';
import { formatDate, formatSize, gameLanguageLabel, relativeDate } from '../format';
import { navigate } from '../hooks/useRoute';
import type { Game, SaveRecord } from '../types';

export function GameDetailPage({ id, refreshLibrary, onFavorite, pendingFavorite }: {
  id: string; refreshLibrary: () => void; onFavorite: (game: Game) => Promise<void>; pendingFavorite: string | null;
}) {
  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saves, setSaves] = useState<SaveRecord[]>([]);
  const [savesError, setSavesError] = useState('');
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError(''); setSavesError('');
    void api.game(id, abort.signal).then((value) => { setGame(value); setTitle(value.title); }).catch((cause) => { if (!abort.signal.aborted) setError(errorMessage(cause)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    void api.saves(id, abort.signal).then(setSaves).catch((cause) => { if (!abort.signal.aborted) setSavesError(errorMessage(cause)); });
    return () => abort.abort();
  }, [id, revision]);
  const rename = async () => {
    if (!title.trim() || !game) return;
    setBusy(true); setMutationError('');
    try { await api.rename(id, title.trim()); setGame({ ...game, title: title.trim() }); setEditing(false); refreshLibrary(); }
    catch (cause) { setMutationError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  const deleteGame = async () => {
    setBusy(true); setMutationError('');
    try { await api.deleteGame(id); refreshLibrary(); navigate('library'); }
    catch (cause) { setMutationError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  if (loading) return <Loading label="正在读取卡带详情…"/>;
  if (error || !game) return <EmptyState icon="warning" title="卡带详情无法读取" description={error || '这张卡带可能已被删除。'} action="重新读取" onAction={() => setRevision((value) => value + 1)}/>;
  return <div className="detail-page">
    <button className="back-link" onClick={() => navigate('library')}><Icon name="back" size={18}/>返回卡带库</button>
    <div className="detail-hero"><CartridgeArt game={game} large/><div className="detail-intro"><div className="detail-badges"><span className="tag">{game.system}</span><span className="tag subtle">{game.source === 'bundled' ? '安装包内置' : '个人导入'}</span>{game.keyboard && <span className="tag subtle">学习键盘</span>}</div><h1>{game.title}</h1>{game.originalTitle && game.originalTitle !== game.title && <p className="original-title">原标题：{game.originalTitle}</p>}<p className="detail-description">{game.description || '自己的卡带，随时打开。键盘、标准手柄与触屏均可控制。'}</p><div className="detail-play-record"><Icon name="clock" size={16}/>{relativeDate(game.lastPlayedAt)}</div><div className="button-row"><button className="button primary" onClick={() => navigate('player', id)}><Icon name="play"/>启动卡带</button><button className={`button secondary${game.favorite ? ' favorited' : ''}`} aria-pressed={game.favorite} disabled={pendingFavorite === id} onClick={async () => { await onFavorite(game); setRevision((value) => value + 1); }}><Icon name="heart"/>{game.favorite ? '已收藏' : '收藏卡带'}</button></div><p className="detail-hint">首次打开会检查已安装的模拟器核心。</p></div></div>
    <div className="detail-columns"><section className="detail-section"><h2>卡带信息</h2><dl className="metadata-list"><div><dt>文件名称</dt><dd>{game.filename || '未提供'}</dd></div><div><dt>卡带格式</dt><dd>{game.format}</dd></div><div><dt>文件大小</dt><dd>{formatSize(game.size)}</dd></div><div><dt>卡带语言</dt><dd>{gameLanguageLabel(game)}</dd></div><div><dt>来源</dt><dd>{game.source === 'bundled' ? '安装包内置' : '个人导入'}</dd></div>{game.license && <div><dt>授权许可</dt><dd>{game.license}</dd></div>}{game.sourceUrl && <div><dt>原作来源</dt><dd><a href={game.sourceUrl} target="_blank" rel="noreferrer">查看原作与授权信息</a></dd></div>}<div><dt>存储映射器</dt><dd>{game.mapper ?? '未提供'}</dd></div><div><dt>加入时间</dt><dd>{formatDate(game.importedAt)}</dd></div>{game.sha256 && <div><dt>SHA-256</dt><dd className="hash-text">{game.sha256}</dd></div>}</dl></section><section className="detail-section"><h2>存档记录 <span>{saves.length}</span></h2>{savesError ? <ErrorNotice message={savesError} onRetry={() => setRevision((value) => value + 1)}/> : saves.length ? <ul className="save-list">{saves.map((save) => <li key={save.id}><Icon name="save"/><div><strong>{save.kind === 'sram' ? '卡带电池存档' : `即时存档 · 槽位 ${save.slot}`}</strong><span>{formatDate(save.createdAt)} · {save.core || '核心未记录'}{save.coreVersion ? ' · 已记录核心版本' : ''}</span></div></li>)}</ul> : <div className="inline-empty"><Icon name="save" size={28}/><p>还没有存档</p><span>运行卡带后，可在播放器中保存进度。</span></div>}</section></div>
    {game.controls && <section className="game-controls-help"><h2>这张卡带怎么玩</h2><p>{game.controls}</p><span>以上为默认键位，可在“使用设置”中自定义两位玩家的按键。</span></section>}
    <section className="library-management"><div><h2>卡带管理</h2><p>{game.source === 'bundled' ? '这张卡带来自安装包。名称和文件由安装包管理。' : '重命名仅更改显示名称。删除会移除此卡带，存档由服务处理。'}</p></div>{game.source === 'imported' && <div className="button-row"><button className="button secondary" onClick={() => { setTitle(game.title); setMutationError(''); setEditing(true); }}><Icon name="edit" size={17}/>重命名</button><button className="button secondary danger-text" onClick={() => { setMutationError(''); setDeleting(true); }}><Icon name="delete" size={17}/>删除卡带</button></div>}</section>
    {editing && <Dialog title="重命名卡带" onClose={() => { if (!busy) setEditing(false); }}><form onSubmit={(event) => { event.preventDefault(); void rename(); }}><label className="field-label">卡带名称<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required disabled={busy}/></label>{mutationError && <ErrorNotice message={mutationError}/>}<div className="dialog-footer"><span/><div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={() => setEditing(false)}>取消</button><button className="button primary" disabled={busy || !title.trim()}>{busy ? '正在保存…' : '保存名称'}</button></div></div></form></Dialog>}
    {deleting && <Dialog title="删除这张卡带" description={`“${game.title}”会从个人卡带库中移除。此操作无法撤销。`} onClose={() => { if (!busy) setDeleting(false); }}>{mutationError && <ErrorNotice message={mutationError}/>}<div className="dialog-footer"><span/><div className="button-row"><button className="button secondary" disabled={busy} onClick={() => setDeleting(false)}>保留卡带</button><button className="button danger" disabled={busy} onClick={() => void deleteGame()}>{busy ? '正在删除…' : '确认删除'}</button></div></div></Dialog>}
  </div>;
}
