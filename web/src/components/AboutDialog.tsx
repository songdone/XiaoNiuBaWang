import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { appUrl } from '../api/urls';
import { downloadBytes } from '../api/download';
import { APP_NAME, type SupportAsset } from '../types';
import { Dialog } from './Dialog';
import { Brand } from './Brand';
import { ErrorNotice, Loading } from './States';
import { Icon } from './Icon';

function SupportImage({ asset, onMissing }: { asset: SupportAsset; onMissing: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const saveOriginal = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(asset.url, { credentials: 'same-origin' });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/jpeg')) throw new Error('赞赏码原图暂时无法下载，请稍后重试。');
      downloadBytes(new Uint8Array(await response.arrayBuffer()), `${asset.kind}-赞赏码原图.jpg`, 'image/jpeg');
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  };
  return <figure className="support-image"><a href={asset.url} target="_blank" rel="noopener noreferrer" aria-label={`放大${asset.label}`}><img src={asset.url} alt={asset.label} loading="eager" onError={onMissing}/></a><figcaption>{asset.label}</figcaption><button className="text-button" disabled={saving} onClick={() => void saveOriginal()}>{saving ? '正在保存…' : '保存原图'}</button>{error && <p className="danger-text" role="alert">{error}</p>}</figure>;
}
export function AboutDialog({ version, onClose }: { version: string | null; onClose: () => void }) {
  const [assets, setAssets] = useState<SupportAsset[]>([]);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError(''); setMissing(new Set());
    void api.supportAssets(abort.signal).then(setAssets).catch((cause) => { if (!abort.signal.aborted) setError(errorMessage(cause)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [revision]);
  const visible = assets.filter((asset) => !missing.has(asset.url));
  return <Dialog title="关于与支持" onClose={onClose}>
    <div className="about-brand"><Brand/><span>{version ? `版本 ${version}` : 'NES 学习机'}</span></div><p className="about-copy">{APP_NAME}让自己的游戏与学习卡带有个家。游戏兼容性取决于卡带和当前模拟器核心。</p><div className="about-license"><Icon name="cartridge" size={20}/><div><p>模拟器核心及第三方组件保留各自的开源许可。</p><div className="button-row"><a className="text-button" href={appUrl('source/source.zip')} download>下载对应源码</a><a className="text-button" href={appUrl('licenses/INDEX.txt')} target="_blank" rel="noopener noreferrer">查看开源许可</a></div></div></div>
    <section className="support-section"><h3>请作者喝杯咖啡</h3><p>用得顺手的话，随意支持一下。谢谢！</p>{loading ? <Loading label="正在读取赞赏码…"/> : error ? <ErrorNotice message={error} onRetry={() => setRevision((value) => value + 1)}/> : missing.size > 0 && visible.length === 0 ? <ErrorNotice message="内置赞赏码图片暂时无法读取。" onRetry={() => setRevision((value) => value + 1)}/> : visible.length ? <><div className="support-images">{visible.map((asset) => <SupportImage key={`${asset.url}:${revision}`} asset={asset} onMissing={() => setMissing((current) => new Set([...current, asset.url]))}/>)}</div>{missing.size > 0 && <ErrorNotice message="部分赞赏码图片暂时无法读取。" onRetry={() => setRevision((value) => value + 1)}/>}</> : <div className="support-absent">赞赏码尚未配置</div>}</section><div className="dialog-footer"><span/><button className="button secondary" onClick={onClose}>关闭</button></div>
  </Dialog>;
}
