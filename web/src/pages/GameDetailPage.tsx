import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { downloadBytes } from '../api/download';
import { CartridgeArt } from '../components/CartridgeArt';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorNotice, Loading } from '../components/States';
import { formatDate, formatSize, gameLanguageLabel, relativeDate } from '../format';
import { navigate } from '../hooks/useRoute';
import { APP_NAME, type Game, type SaveRecord } from '../types';

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
  const [deletingSave, setDeletingSave] = useState<SaveRecord | null>(null);
  const [title, setTitle] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError(''); setSavesError('');
    void api.game(id, abort.signal).then((value) => { setGame(value); setTitle(value.title); }).catch((cause) => { if (!abort.signal.aborted) setError(errorMessage(cause)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    void api.saves(id, abort.signal).then(setSaves).catch((cause) => { if (!abort.signal.aborted) setSavesError(errorMessage(cause)); });
    return () => abort.abort();
  }, [id, revision]);

  useEffect(() => {
    if (game?.title) document.title = `${game.title} · 详情 · ${APP_NAME}`;
    return () => { document.title = `${APP_NAME} · 我的卡带库`; };
  }, [game?.title]);

  const rename = async () => {
    const trimmed = title.trim();
    if (!trimmed || !game) return;
    setBusy(true); setMutationError(''); setNotice('');
    try { await api.rename(id, trimmed); setGame({ ...game, title: trimmed }); setEditing(false); setNotice(`已重命名为“${trimmed}”。`); refreshLibrary(); }
    catch (cause) { setMutationError(errorMessage(cause)); }
    finally { setBusy(false); }
  };

  const deleteGame = async () => {
    setBusy(true); setMutationError('');
    try { await api.deleteGame(id); refreshLibrary(); navigate('library'); }
    catch (cause) { setMutationError(errorMessage(cause)); }
    finally { setBusy(false); }
  };

  const toggleFavorite = async () => {
    if (!game) return;
    const nextFavorite = !game.favorite;
    setGame({ ...game, favorite: nextFavorite });
    try {
      await onFavorite(game);
    } catch {
      setGame((current) => current ? { ...current, favorite: !nextFavorite } : current);
    }
  };

  const downloadSave = async (save: SaveRecord) => {
    if (!game) return;
    setSavesError('');
    try {
      const bytes = await api.saveBytes(save);
      const ext = save.kind === 'sram' ? 'sav' : 'state';
      const label = save.kind === 'sram' ? 'sram' : `slot-${save.slot}`;
      downloadBytes(bytes, `${game.title}-${label}.${ext}`);
      setNotice(`已下载${save.kind === 'sram' ? '卡带电池存档' : `槽位 ${save.slot} 存档`}。`);
    } catch (cause) { setSavesError(errorMessage(cause)); }
  };

  const confirmDeleteSave = async () => {
    if (!deletingSave) return;
    setBusy(true); setMutationError('');
    try {
      await api.deleteSave(deletingSave);
      setSaves((current) => current.filter((item) => item.id !== deletingSave.id));
      setNotice(`已删除${deletingSave.kind === 'sram' ? '卡带电池存档' : `槽位 ${deletingSave.slot} 存档`}。`);
      setDeletingSave(null);
    } catch (cause) { setMutationError(errorMessage(cause)); }
    finally { setBusy(false); }
  };

  const handleCoverUpload = async (file: File | null) => {
    if (!file || !game || game.source !== 'imported' || coverBusy) return;
    setCoverBusy(true); setMutationError(''); setNotice('');
    try {
      const updated = await api.uploadCover(game.id, file);
      setGame(updated);
      refreshLibrary();
      setNotice('自定义卡带封面已更新。');
    } catch (cause) { setMutationError(errorMessage(cause)); }
    finally { setCoverBusy(false); }
  };

  const resetCover = async () => {
    if (!game || game.source !== 'imported' || coverBusy) return;
    setCoverBusy(true); setMutationError(''); setNotice('');
    try {
      const updated = await api.deleteCover(game.id);
      setGame(updated);
      refreshLibrary();
      setNotice('已恢复默认卡带外壳。');
    } catch (cause) { setMutationError(errorMessage(cause)); }
    finally { setCoverBusy(false); }
  };

  if (loading) return <Loading label="正在读取卡带详情…"/>;
  if (error || !game) return <EmptyState icon="warning" title="卡带详情无法读取" description={error || '这张卡带可能已被删除。'} action="重新读取" onAction={() => setRevision((value) => value + 1)}/>;

  return <div className="detail-page">
    <button className="back-link" onClick={() => navigate('library')}><Icon name="back" size={18}/>返回卡带库</button>
    {notice && <div className="notice success" role="status"><Icon name="check"/><span>{notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" size={16}/></button></div>}
    {mutationError && !editing && !deleting && !deletingSave && <ErrorNotice message={mutationError}/>}
    <div className="detail-hero">
      <div className="detail-cover-column">
        <CartridgeArt game={game} large/>
        {game.source === 'imported' && <div className="detail-cover-actions">
          <input ref={coverInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} onChange={(event) => { void handleCoverUpload(event.target.files?.[0] || null); event.target.value = ''; }}/>
          <button type="button" className="text-button" disabled={coverBusy} onClick={() => coverInputRef.current?.click()}><Icon name="image" size={16}/>{coverBusy ? '正在处理…' : '更换封面'}</button>
          {game.coverUrl && <button type="button" className="text-button" disabled={coverBusy} onClick={() => void resetCover()}>恢复默认外壳</button>}
        </div>}
      </div>
      <div className="detail-intro">
        <div className="detail-badges"><span className="tag">{game.system}</span><span className="tag subtle">{game.source === 'bundled' ? '安装包内置' : '个人导入'}</span>{game.keyboard && <span className="tag subtle">学习键盘</span>}</div>
        <div className="detail-title-row">
          <h1>{game.title}</h1>
          {game.source === 'imported' && <button type="button" className="icon-button title-edit-button" aria-label="重命名卡带" title="重命名卡带" onClick={() => { setTitle(game.title); setMutationError(''); setEditing(true); }}><Icon name="edit" size={18}/></button>}
        </div>
        {game.originalTitle && game.originalTitle !== game.title && <p className="original-title">原标题：{game.originalTitle}</p>}
        <p className="detail-description">{game.description || '自己的卡带，随时打开。键盘、标准手柄与触屏均可控制。'}</p>
        <div className="detail-play-record"><Icon name="clock" size={16}/>{relativeDate(game.lastPlayedAt)}</div>
        <div className="button-row">
          <button className="button primary" onClick={() => navigate('player', id)}><Icon name="play"/>启动卡带</button>
          <button className={`button secondary${game.favorite ? ' favorited' : ''}`} aria-pressed={game.favorite} disabled={pendingFavorite === id} onClick={() => void toggleFavorite()}><Icon name="heart"/>{game.favorite ? '已收藏' : '收藏卡带'}</button>
        </div>
        <p className="detail-hint">首次打开会检查已安装的模拟器核心；运行中也可直接截取游戏画面设为封面。</p>
      </div>
    </div>
    <div className="detail-columns">
      <section className="detail-section">
        <h2>卡带信息</h2>
        <dl className="metadata-list">
          <div><dt>文件名称</dt><dd>{game.filename || '未提供'}</dd></div>
          <div><dt>卡带格式</dt><dd>{game.format}</dd></div>
          <div><dt>文件大小</dt><dd>{formatSize(game.size)}</dd></div>
          <div><dt>卡带语言</dt><dd>{gameLanguageLabel(game)}</dd></div>
          <div><dt>来源</dt><dd>{game.source === 'bundled' ? '安装包内置' : '个人导入'}</dd></div>
          {game.license && <div><dt>授权许可</dt><dd>{game.license}</dd></div>}
          {game.sourceUrl && <div><dt>原作来源</dt><dd><a href={game.sourceUrl} target="_blank" rel="noreferrer">查看原作与授权信息</a></dd></div>}
          <div><dt>存储映射器</dt><dd>{game.mapper ?? '未提供'}</dd></div>
          <div><dt>加入时间</dt><dd>{formatDate(game.importedAt)}</dd></div>
          {game.sha256 && <div><dt>SHA-256</dt><dd className="hash-text">{game.sha256}</dd></div>}
        </dl>
      </section>
      <section className="detail-section">
        <h2>存档记录 <span>{saves.length}</span></h2>
        {savesError ? <ErrorNotice message={savesError} onRetry={() => setRevision((value) => value + 1)}/> : saves.length ? <ul className="save-list">
          {saves.map((save) => <li key={save.id}>
            {save.thumbUrl ? <img className="save-list-thumb" src={save.thumbUrl} alt="" loading="lazy"/> : <Icon name="save"/>}
            <div>
              <strong>{save.kind === 'sram' ? '卡带电池存档' : `即时存档 · 槽位 ${save.slot}${save.slot === 10 ? '（自动）' : ''}`}</strong>
              <span>{formatDate(save.createdAt)}{save.size ? ` · ${formatSize(save.size)}` : ''} · {save.core || '核心未记录'}</span>
            </div>
            <div className="save-item-actions">
              {save.kind === 'state' && <button type="button" className="text-button" onClick={() => navigate('player', id, save.slot)}><Icon name="play" size={14}/>从此槽位开始</button>}
              <button type="button" className="icon-button" aria-label={`下载${save.kind === 'sram' ? '电池存档' : `槽位 ${save.slot} 存档`}`} title="下载存档" onClick={() => void downloadSave(save)}><Icon name="load" size={16}/></button>
              <button type="button" className="icon-button danger-text" aria-label={`删除${save.kind === 'sram' ? '电池存档' : `槽位 ${save.slot} 存档`}`} title="删除存档" onClick={() => { setMutationError(''); setDeletingSave(save); }}><Icon name="delete" size={16}/></button>
            </div>
          </li>)}
        </ul> : <div className="inline-empty"><Icon name="save" size={28}/><p>还没有存档</p><span>运行卡带后，可在播放器中保存进度。</span></div>}
      </section>
    </div>
    {game.controls && <section className="game-controls-help"><h2>这张卡带怎么玩</h2><p>{game.controls}</p><span>以上为默认键位，可在“使用设置”中自定义两位玩家的按键。</span></section>}
    <section className="library-management">
      <div><h2>卡带管理</h2><p>{game.source === 'bundled' ? '这张卡带来自安装包。名称和文件由安装包管理。' : '重命名仅更改显示名称。删除会移除此卡带及其存档和自定义封面。'}</p></div>
      {game.source === 'imported' && <div className="button-row"><button className="button secondary" onClick={() => { setTitle(game.title); setMutationError(''); setEditing(true); }}><Icon name="edit" size={17}/>重命名</button><button className="button secondary danger-text" onClick={() => { setMutationError(''); setDeleting(true); }}><Icon name="delete" size={17}/>删除卡带</button></div>}
    </section>
    {editing && <Dialog title="重命名卡带" onClose={() => { if (!busy) setEditing(false); }}><form onSubmit={(event) => { event.preventDefault(); void rename(); }}><label className="field-label">卡带名称<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required disabled={busy}/></label>{mutationError && <ErrorNotice message={mutationError}/>}<div className="dialog-footer"><span/><div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={() => setEditing(false)}>取消</button><button className="button primary" disabled={busy || !title.trim()}>{busy ? '正在保存…' : '保存名称'}</button></div></div></form></Dialog>}
    {deleting && <Dialog title="删除这张卡带" description={`“${game.title}”会从个人卡带库中移除。此操作无法撤销。`} onClose={() => { if (!busy) setDeleting(false); }}>{mutationError && <ErrorNotice message={mutationError}/>}<div className="dialog-footer"><span/><div className="button-row"><button className="button secondary" disabled={busy} onClick={() => setDeleting(false)}>保留卡带</button><button className="button danger" disabled={busy} onClick={() => void deleteGame()}>{busy ? '正在删除…' : '确认删除'}</button></div></div></Dialog>}
    {deletingSave && <Dialog title="删除存档记录" description={`确定要删除${deletingSave.kind === 'sram' ? '卡带电池存档' : `即时存档槽位 ${deletingSave.slot}`}吗？此操作无法撤销。`} onClose={() => { if (!busy) setDeletingSave(null); }}>{mutationError && <ErrorNotice message={mutationError}/>}<div className="dialog-footer"><span/><div className="button-row"><button className="button secondary" disabled={busy} onClick={() => setDeletingSave(null)}>取消</button><button className="button danger" disabled={busy} onClick={() => void confirmDeleteSave()}>{busy ? '正在删除…' : '确认删除'}</button></div></div></Dialog>}
  </div>;
}
