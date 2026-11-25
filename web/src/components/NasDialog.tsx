import { useEffect, useRef, useState } from 'react';
import { api, ApiError, NasRootsError, errorMessage, type NasDirectory, type NasRoots, type ScanJob } from '../api/client';
import { authorizeDirectory, takeNasReturn, type AuthOutcome, type DirectoryAuthorization } from '../fnos/authorization';
import { NativePickerUnavailable } from '../fnos/native';
import { appUrl } from '../api/urls';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { ErrorNotice, Loading } from './States';
import { formatSize } from '../format';

const STATUS_LABELS = { queued: '等待扫描', running: '扫描中', completed: '扫描完成', cancelled: '已取消', failed: '扫描失败' };
const ACTIVE_JOB_KEY = 'xnbw-active-scan';
const AUTH_NOTICES: Record<AuthOutcome, string> = { success: '飞牛目录选择已返回，正在核对服务器可读取的授权目录。', cancel: '已取消目录选择。', error: '目录授权未完成，请重新选择并授权。', expired: '目录授权已过期，请重新选择并授权。' };
const invalidReference = (cause: unknown) => cause instanceof ApiError && [401, 403, 410].includes(cause.status);
const nasErrorMessage = (cause: unknown) => {
  const message = errorMessage(cause);
  return /[/\\]|nas_[A-Za-z0-9_-]+/.test(message) ? '服务器目录操作未完成，请检查目录权限与应用服务状态。' : message;
};
function rootFeedback(roots: NasRoots) {
  const detail = roots.diagnostics;
  if (detail && detail.authorized > detail.usable && (detail.invalidPath || detail.aclDenied || detail.directoryUnreadable)) {
    const reasons = [detail.directoryUnreadable > 0 ? '应用无法读取目录内容或访问上级目录' : '', detail.aclDenied > 0 ? '当前账号的目录读取权限未通过检查' : '', detail.invalidPath > 0 ? '飞牛返回的目录位置无效或不符合安全要求' : ''].filter(Boolean).join('；');
    return { title: roots.roots.length ? '部分授权目录暂不可用' : '已授权，但应用无法读取目录', message: `飞牛已有目录授权，但${reasons}。请检查该账号与应用服务对目录的读取、上级目录的访问权限；目录需真实存在，且不能是符号链接。修复后再刷新授权目录，也可添加其他可读取的目录。重新授权或反复刷新不会自动修复读取权限。` };
  }
  return { title: '还没有已授权的目录', message: '点击“添加卡带目录”，在飞牛目录窗口选择并授权。无需离开应用前往系统设置。' };
}
export function NasDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [roots, setRoots] = useState<NasRoots | null>(null);
  const [directory, setDirectory] = useState<NasDirectory | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [job, setJob] = useState<ScanJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [browserFallback, setBrowserFallback] = useState(false);
  const [error, setError] = useState('');
  const [rootError, setRootError] = useState<'login' | 'response' | 'unavailable' | 'connection' | null>(null);
  const [gatewayAvailable, setGatewayAvailable] = useState(false);
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [pollRevision, setPollRevision] = useState(0);
  const authorization = useRef<DirectoryAuthorization | null>(null);
  const rootSnapshot = useRef<NasRoots | null>(null);
  const autoSelect = useRef(false);
  const notified = useRef(new Set<string>());
  const mounted = useRef(false);
  const browseGeneration = useRef(0);
  const entryList = useRef<HTMLDivElement | null>(null);
  const importedCallback = useRef(onImported); importedCallback.current = onImported;
  const active = job?.status === 'queued' || job?.status === 'running';
  const clearDirectory = () => { browseGeneration.current++; setDirectory(null); setSelected([]); setLabels({}); };
  const refresh = () => { clearDirectory(); setRoots(null); setNotice(''); setRevision((value) => value + 1); };
  const acceptJob = (next: ScanJob) => {
    setJob(next);
    if (!['queued', 'running'].includes(next.status) && !notified.current.has(next.id)) {
      notified.current.add(next.id);
      try { sessionStorage.removeItem(ACTIVE_JOB_KEY); } catch { /* Server jobs are independent of storage. */ }
      // Cancelled/failed scans can have successfully imported a prefix too.
      if (next.imported > 0) importedCallback.current();
      if (next.errors.some((item) => ['access_denied', 'nas_refresh_required'].includes(item.code))) refresh();
    }
  };
  const browse = async (path: string) => {
    const generation = ++browseGeneration.current;
    setLoading(true); setError(''); setDirectory(null); setSelected([]);
    try {
      const next = await api.nasBrowse(path);
      if (!mounted.current || generation !== browseGeneration.current) return;
      setDirectory(next); setLabels((current) => ({ ...current, ...Object.fromEntries(next.entries.map((entry) => [entry.path, entry.name])) }));
    } catch (cause) {
      if (!mounted.current || generation !== browseGeneration.current) return;
      if (invalidReference(cause)) refresh();
      setError(nasErrorMessage(cause));
    } finally { if (mounted.current && generation === browseGeneration.current) setLoading(false); }
  };
  useEffect(() => {
    mounted.current = true;
    const outcome = takeNasReturn();
    if (outcome) { setNotice(AUTH_NOTICES[outcome]); autoSelect.current = outcome === 'success'; }
    try {
      const id = sessionStorage.getItem(ACTIVE_JOB_KEY);
      if (id) void api.nasScanStatus(id).then((value) => { if (mounted.current) acceptJob(value); }).catch(() => sessionStorage.removeItem(ACTIVE_JOB_KEY));
    } catch { /* Scans remain server-owned if storage is unavailable. */ }
    return () => { mounted.current = false; browseGeneration.current++; authorization.current?.cancel(); authorization.current = null; };
  }, []);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError(''); setRootError(null);
    clearDirectory();
    void api.nasRoots(abort.signal).then((value) => {
      if (abort.signal.aborted) return;
      const previous = rootSnapshot.current;
      setRoots(value); rootSnapshot.current = value; setGatewayAvailable(value.available);
      setLabels(Object.fromEntries(value.roots.map((root) => [root.path, root.name])));
      if (autoSelect.current) {
        autoSelect.current = false;
        const additions = value.roots.filter((root) => !previous?.roots.some((old) => old.path === root.path));
        const target = additions.length === 1 ? additions[0] : value.roots.length === 1 ? value.roots[0] : null;
        if (value.available && !value.issue && target && value.capabilities.browse) void browse(target.path);
        setNotice(value.roots.length && !value.issue ? '服务器已返回可读取的授权目录。尚未导入卡带，请点击“扫描并导入此目录”或选文件导入。' : value.available ? '飞牛目录选择已返回，但服务器尚未提供可读取目录。此次操作没有导入卡带，请查看下方原因。' : '飞牛目录选择已返回，但服务器目录服务暂不可用。此次操作没有导入卡带。');
      }
    }).catch((cause) => {
      if (abort.signal.aborted) return;
      autoSelect.current = false; setRoots(null); setNotice(''); setError(nasErrorMessage(cause));
      setRootError(cause instanceof NasRootsError ? 'response' : cause instanceof ApiError && cause.status === 401 ? 'login' : cause instanceof ApiError && cause.status === 503 ? 'unavailable' : 'connection');
      if (cause instanceof NasRootsError && cause.available) setGatewayAvailable(true);
      else if (cause instanceof ApiError && [401, 503].includes(cause.status)) setGatewayAvailable(false);
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [revision]);
  useEffect(() => {
    if (!job || !active) return;
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      void api.nasScanStatus(job.id, abort.signal).then((updated) => { if (!abort.signal.aborted) acceptJob(updated); }).catch((cause) => { if (!abort.signal.aborted) { setError(nasErrorMessage(cause)); setPollRevision((value) => value + 1); } });
    }, 1000);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [job, active, pollRevision]);
  const addDirectory = () => {
    setError(''); setNotice(''); setBrowserFallback(false);
    try {
      const flow = authorizeDirectory(); authorization.current = flow;
      setAuthorizing(true); setPopupBlocked(flow.popupBlocked);
      setNotice(flow.popupBlocked ? '浏览器阻止了授权窗口。可在当前窗口继续，授权后会自动返回此对话框。' : '请在飞牛窗口选择卡带目录并确认授权。');
      void flow.result.then((outcome) => {
        if (!mounted.current || authorization.current !== flow) return;
        authorization.current = null; setAuthorizing(false); setPopupBlocked(false); setNotice(AUTH_NOTICES[outcome]);
        if (outcome === 'success') { autoSelect.current = true; refresh(); }
      }).catch((cause) => {
        if (!mounted.current || authorization.current !== flow) return;
        authorization.current = null; setAuthorizing(false); setPopupBlocked(false); setBrowserFallback(cause instanceof NativePickerUnavailable); setError(nasErrorMessage(cause));
      });
    } catch (cause) { setBrowserFallback(cause instanceof NativePickerUnavailable); setError(nasErrorMessage(cause)); }
  };
  const scan = async () => {
    if (!directory) return;
    setBusy(true); setError(''); setNotice('');
    try { const next = await api.nasScan(directory.path); acceptJob(next); try { sessionStorage.setItem(ACTIVE_JOB_KEY, next.id); } catch { /* Server job stays visible in this session. */ } }
    catch (cause) { if (invalidReference(cause)) refresh(); setError(nasErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  const importSelected = async () => {
    if (!selected.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.nasImport(selected);
      const skippedText = result.skipped ? `，跳过重复 ${result.skipped} 张` : '';
      setNotice(`已导入 ${result.imported} 张卡带${skippedText}${result.failed.length ? `，${result.failed.length} 个文件未能导入。` : '。'}`);
      if (result.failed.some((item) => ['access_denied', 'nas_refresh_required'].includes(item.code))) refresh();
      else setSelected(result.failed.map((item) => item.path));
      onImported();
    } catch (cause) {
      if (invalidReference(cause)) refresh(); setError(nasErrorMessage(cause));
      // A disconnected/aborted batch may already have committed some imports.
      onImported();
    } finally { setBusy(false); }
  };
  const feedback = roots ? rootFeedback(roots) : null;
  return <Dialog title="服务器目录" description="选择并授权目录后，点击“扫描并导入此目录”添加卡带；刷新目录不会增加卡带库数量。" onClose={() => { if (!busy) onClose(); }} wide>
    {error && <ErrorNotice message={error} onRetry={rootError === 'login' || rootError === 'response' ? undefined : refresh}/>}
    {notice && <div className="notice" role="status"><Icon name="folder"/><span>{notice}</span></div>}
    <div className="nas-toolbar"><button className="button primary" disabled={busy || authorizing || !gatewayAvailable} onClick={addDirectory}><Icon name="plus" size={17}/>添加卡带目录</button><button className="button secondary" disabled={busy || authorizing || loading} onClick={refresh}><Icon name="refresh" size={17}/>刷新授权目录</button></div>
    {browserFallback && <p className="small-muted"><a href={`${location.origin}${appUrl('')}`} target="_blank" rel="noopener noreferrer">在浏览器中打开本应用</a>，登录后点击“添加卡带目录”。若客户端未打开外部浏览器，请使用其“在浏览器打开”菜单。</p>}
    {authorizing && <div className="nas-actions">{popupBlocked && <button className="button primary" onClick={() => { try { authorization.current?.continueInSameWindow(); } catch (cause) { setError(nasErrorMessage(cause)); } }}>在当前窗口选择并授权</button>}<button className="button secondary" onClick={() => authorization.current?.cancel()}>取消目录授权</button></div>}
    {loading ? <Loading label="正在读取服务器目录…"/> : rootError ? <div className="nas-unavailable"><Icon name="folder" size={36}/><h3>{rootError === 'login' ? '登录已过期' : rootError === 'response' ? '服务器目录响应异常' : rootError === 'unavailable' ? '服务器目录服务暂不可用' : '无法读取服务器目录状态'}</h3><p>{rootError === 'login' ? '请从飞牛应用入口重新打开并登录。' : rootError === 'response' ? '无法根据当前响应确认授权目录，不能将其视为尚未授权。请检查目录服务与应用版本是否兼容。' : rootError === 'unavailable' ? '请检查飞牛目录服务是否已启动，或从飞牛应用入口打开。' : '请检查网络和应用服务后重试。当前没有导入任何新卡带。'}</p></div> : !roots?.available ? <div className="nas-unavailable"><Icon name="folder" size={36}/><h3>服务器目录暂不可用</h3><p>本地预览不提供飞牛目录授权。请从飞牛应用入口打开，使用“添加卡带目录”选择并授权。</p></div> : !roots.roots.length ? <div className="nas-unavailable"><Icon name="folder" size={36}/><h3>{feedback?.title}</h3><p>{feedback?.message}</p>{!roots.diagnostics && notice.startsWith('飞牛目录选择已返回') && <p>目录选择返回成功不代表服务器已获得可读取目录。可在飞牛目录窗口核对选择是否保存，以及账号与应用的读取权限。</p>}</div> : <>
      {feedback?.title === '部分授权目录暂不可用' && <div className="notice" role="status"><Icon name="folder"/><span>{feedback.title}。{feedback.message}</span></div>}
      <div className="nas-toolbar"><button className="text-button" disabled={busy || authorizing} onClick={clearDirectory}><Icon name="folder" size={17}/>授权目录</button>{directory && <button className="text-button" disabled={busy || authorizing || !directory.parent} onClick={() => { if (directory.parent) void browse(directory.parent); }}><Icon name="back" size={16}/>上一级</button>}</div>
      {directory && <p className="nas-path">{labels[directory.path] || '已授权目录'}</p>}
      {directory && <><p className="small-muted">浏览目录不会导入卡带。“扫描并导入此目录”会检查此目录及子目录，并将找到的有效卡带添加到卡带库；也可只浏览并选择文件导入。</p><div className="nas-actions"><button className="button primary" disabled={busy || authorizing || active || !roots.capabilities.scan} onClick={() => void scan()}><Icon name="search" size={17}/>{busy ? '正在处理…' : job?.path === directory.path ? '重新扫描并导入此目录' : '扫描并导入此目录'}</button><button className="button secondary" disabled={busy || authorizing} onClick={() => entryList.current?.querySelector<HTMLInputElement>('input')?.focus()}>只浏览 / 选文件导入</button></div></>}
      <div className="nas-entry-list" ref={entryList}>{(directory?.entries || roots.roots).map((entry) => <div className="nas-entry" key={entry.path}>
        {entry.kind === 'directory' ? <button disabled={busy || authorizing || !roots.capabilities.browse} className="nas-directory" onClick={() => void browse(entry.path)}><Icon name="folder" size={21}/><span>{entry.name}</span><Icon name="chevron" size={16}/></button> : <label><input type="checkbox" checked={selected.includes(entry.path)} disabled={busy || authorizing || !roots.capabilities.importFiles} onChange={(event) => setSelected((current) => event.target.checked ? [...current, entry.path] : current.filter((value) => value !== entry.path))}/><Icon name="cartridge" size={19}/><span>{entry.name}</span><small>{formatSize(entry.size ?? null)}</small></label>}
      </div>)}</div>{directory?.entries.length === 0 && <p className="small-muted">此目录没有可显示的子目录或卡带。</p>}{directory?.truncated && <p className="small-muted">目录较大，浏览仅显示部分条目。扫描会分批检查目录；达到数量、深度或时间上限时会明确提示，已导入卡带会保留。</p>}{(directory?.skippedLinks ?? 0) > 0 && <p className="small-muted">为保证安全，已跳过 {directory?.skippedLinks} 个符号链接或非常规文件。</p>}
      {directory && <div className="nas-actions"><button className="button secondary" disabled={busy || authorizing || !selected.length || !roots.capabilities.importFiles} onClick={() => void importSelected()}><Icon name="plus" size={17}/>{busy ? '正在处理…' : `导入已选 ${selected.length} 项`}</button></div>}
    </>}
    {job && <section className="scan-job" aria-live="polite"><div><h3>{STATUS_LABELS[job.status]}</h3>{active && <button className="text-button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { acceptJob(await api.nasCancelScan(job.id)); } catch (cause) { setError(nasErrorMessage(cause)); } finally { setBusy(false); } }}>取消扫描</button>}</div><p className="nas-path">{labels[job.path] || '已授权扫描目录'}</p><div className="scan-counts"><span>已检查 <b>{job.visited}</b></span><span>找到 <b>{job.discovered}</b></span><span>已导入 <b>{job.imported}</b></span>{(job.skipped ?? 0) > 0 && <span>跳过重复 <b>{job.skipped}</b></span>}<span>失败 <b>{job.failed}</b></span></div>{job.status === 'failed' && <p className="small-muted">扫描未能检查全部文件，已导入卡带仍在卡带库中。请查看错误，刷新目录后可重新扫描。</p>}{job.status === 'cancelled' && <p className="small-muted">扫描已停止，已导入卡带已保留。</p>}{job.errors.length > 0 && <details><summary>查看 {job.errors.length} 个错误</summary><ul>{job.errors.map((item, index) => <li key={`${item.path}-${index}`}><strong>{labels[item.path] || `文件 ${index + 1}`}</strong><span>{nasErrorMessage(new Error(item.message))}</span></li>)}</ul></details>}</section>}
    <div className="dialog-footer"><span/><button className="button secondary" disabled={busy} onClick={onClose}>关闭</button></div>
  </Dialog>;
}
