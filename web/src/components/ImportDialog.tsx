import { useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { navigate } from '../hooks/useRoute';
import type { Game } from '../types';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { formatSize } from '../format';
import { ErrorNotice } from './States';

type UploadItem = { file: File; status: 'pending' | 'uploading' | 'success' | 'error'; error?: string; game?: Game | null };
export function ImportDialog({ onClose, onImported, onNas }: { onClose: () => void; onImported: () => void; onNas: () => void }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [title, setTitle] = useState('');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addFiles = (files: FileList | File[]) => {
    if (busy) return;
    const incoming = Array.from(files);
    const accepted = incoming.filter((file) => /\.(nes|zip)$/i.test(file.name));
    setError(accepted.length !== incoming.length ? '部分文件未加入，请选择 .nes 卡带文件或单卡 .zip 压缩包。' : '');
    setItems((current) => [...current, ...accepted.filter((file) => !current.some((item) => item.file.name === file.name && item.file.size === file.size)).map((file): UploadItem => ({ file, status: 'pending' }))]);
  };
  const upload = async () => {
    const pending = items.map((item, index) => ({ item, index })).filter(({ item }) => item.status === 'pending' || item.status === 'error');
    if (!pending.length) return;
    setBusy(true); setError('');
    let imported = false;
    for (const { item, index } of pending) {
      setItems((current) => current.map((entry, i) => i === index ? { ...entry, status: 'uploading', error: undefined } : entry));
      try {
        const created = await api.importGame(item.file, items.length === 1 ? title : undefined);
        imported = true;
        setItems((current) => current.map((entry, i) => i === index ? { ...entry, status: 'success', game: created } : entry));
      } catch (cause) {
        setItems((current) => current.map((entry, i) => i === index ? { ...entry, status: 'error', error: errorMessage(cause) } : entry));
      }
    }
    setBusy(false);
    if (imported) onImported();
  };
  const pendingCount = items.filter((item) => item.status !== 'success').length;
  const singleImported = items.length === 1 && items[0].status === 'success' ? items[0].game : null;
  const playImported = (gameId: string) => {
    onClose();
    void navigate('player', gameId);
  };
  return <Dialog title="导入卡带" description="选择自己拥有使用权的游戏或学习卡带文件。" onClose={() => { if (!busy) onClose(); }} wide>
    <div className={`drop-zone${dragging ? ' dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}>
      <Icon name="upload" size={32}/><h3>把卡带文件拖到这里</h3><p>.nes 卡带文件或单卡 .zip 压缩包 · 可一次选择多个</p><button className="button secondary" disabled={busy} onClick={() => inputRef.current?.click()}>选择文件</button><input ref={inputRef} type="file" multiple accept=".nes,.zip" className="sr-only" tabIndex={-1} onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ''; }}/>
    </div>
    <button className="nas-import-link" disabled={busy} onClick={onNas}><Icon name="folder"/><span>从已授权的服务器目录导入</span><Icon name="chevron" size={16}/></button>
    {error && <ErrorNotice message={error}/>}
    {items.length === 1 && items[0].status !== 'success' && <label className="field-label import-title">卡带名称 <span>可选，留空则使用文件名</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} disabled={busy} placeholder={items[0].file.name.replace(/\.[^.]+$/, '')}/></label>}
    {items.length > 0 && <ul className="upload-list">{items.map((item, index) => <li key={`${item.file.name}-${item.file.size}`} className={`upload-${item.status}`}><Icon name={item.status === 'success' ? 'check' : item.status === 'error' ? 'warning' : 'cartridge'}/><div><strong>{item.file.name}</strong><span>{item.error || `${formatSize(item.file.size)} · ${item.status === 'success' ? '已导入' : item.status === 'uploading' ? '正在导入…' : '等待导入'}`}</span></div>{item.status === 'uploading' ? <span className="spinner"/> : item.status === 'success' && item.game ? <button type="button" className="text-button" onClick={() => playImported(item.game!.id)}><Icon name="play" size={14}/>试玩</button> : item.status !== 'success' && <button className="icon-button" aria-label={`移除 ${item.file.name}`} disabled={busy} onClick={() => setItems((current) => current.filter((_, i) => i !== index))}><Icon name="close" size={17}/></button>}</li>)}</ul>}
    <div className="dialog-footer"><p>由服务器校验格式和大小；不支持的卡带会返回具体原因。</p><div className="button-row"><button className="button secondary" disabled={busy} onClick={onClose}>{pendingCount === 0 && items.length ? '完成' : '取消'}</button>{singleImported ? <button className="button primary" onClick={() => playImported(singleImported.id)}><Icon name="play" size={17}/>立即试玩</button> : <button className="button primary" disabled={busy || pendingCount === 0} onClick={() => void upload()}>{busy ? <span className="spinner"/> : <Icon name="upload" size={18}/>}{busy ? '正在导入' : `导入${pendingCount ? ` ${pendingCount} 张卡带` : '卡带'}`}</button>}</div></div>
  </Dialog>;
}
