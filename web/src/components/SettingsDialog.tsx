import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, type RestoreResult } from '../api/client';
import { downloadBytes } from '../api/download';
import type { PlayerNumber } from '../emulator/adapter';
import { APP_SHORT_NAME, type Settings } from '../types';
import { BUTTONS, BUTTON_LABELS, DEFAULT_MAPPINGS, KEY_PRESETS, keyLabel, type MappableButton } from '../input/mappings';
import { applyColorScheme, setAutoPauseOnBlur, setAutoSaveOnExit, setTouchHaptics, useLocalPreferences, useSystemDark, type ColorSchemePreference } from '../preferences';
import { Dialog } from './Dialog';
import { ErrorNotice, Loading } from './States';
import { Icon } from './Icon';

export type SettingsTab = 'general' | 'input' | 'backup';

export function SettingsDialog({ onClose, onSaved, onRestored, initialTab = 'general' }: { onClose: () => void; onSaved: (settings: Settings) => void; onRestored: () => void; initialTab?: SettingsTab }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [binding, setBinding] = useState<{ player: PlayerNumber; button: MappableButton } | null>(null);
  const [bindingError, setBindingError] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState('');
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const operationRef = useRef(false);
  const mountedRef = useRef(true);
  const localPrefs = useLocalPreferences();
  const systemDark = useSystemDark();
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    const abort = new AbortController(); setError('');
    void api.settings(abort.signal).then(setSettings).catch((cause) => { if (!abort.signal.aborted) setError(errorMessage(cause)); });
    return () => abort.abort();
  }, [revision]);
  useEffect(() => {
    if (!binding || !settings) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (event.code === 'Escape') { setBinding(null); return; }
      if (event.metaKey || event.ctrlKey || event.altKey || ['Tab', 'MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight'].includes(event.code)) {
        setBindingError('请选择普通按键；浏览器快捷键、制表键和修饰键保留给系统。'); return;
      }
      for (const player of [1, 2] as PlayerNumber[]) {
        for (const button of BUTTONS) {
          if ((player !== binding.player || button !== binding.button) && settings.keyboardMappings[player][button] === event.code) {
            setBindingError(`此按键已用于玩家 ${player} 的“${BUTTON_LABELS[button]}”，请先改用其他按键。`); return;
          }
        }
      }
      setSettings({ ...settings, keyboardMappings: { ...settings.keyboardMappings, [binding.player]: { ...settings.keyboardMappings[binding.player], [binding.button]: event.code } } });
      setBinding(null); setBindingError('');
    };
    window.addEventListener('keydown', capture, true);
    return () => window.removeEventListener('keydown', capture, true);
  }, [binding, settings]);
  const save = async () => {
    if (!settings || operationRef.current) return;
    operationRef.current = true;
    setSaving(true); setError('');
    try { await api.updateSettings(settings); if (mountedRef.current) { onSaved(settings); onClose(); } }
    catch (cause) { if (mountedRef.current) setError(errorMessage(cause)); }
    finally { operationRef.current = false; if (mountedRef.current) setSaving(false); }
  };
  const backup = async (mode: 'full' | 'saves' = 'full') => {
    if (operationRef.current) return;
    operationRef.current = true;
    setBackupBusy(true); setBackupError('');
    try {
      const date = new Date().toISOString().slice(0, 10);
      const name = mode === 'saves' ? `${APP_SHORT_NAME}-存档备份-${date}.zip` : `${APP_SHORT_NAME}-备份-${date}.zip`;
      downloadBytes(await api.backup(mode), name, 'application/zip');
    }
    catch (cause) { if (mountedRef.current) setBackupError(errorMessage(cause)); }
    finally { operationRef.current = false; if (mountedRef.current) setBackupBusy(false); }
  };
  const restore = async () => {
    if (!restoreFile || operationRef.current) return;
    operationRef.current = true;
    setBackupBusy(true); setBackupError(''); setRestoreResult(null);
    try { const result = await api.restore(restoreFile); if (mountedRef.current) { setRestoreResult(result); setRestoreFile(null); onRestored(); setRevision((value) => value + 1); } }
    catch (cause) { if (mountedRef.current) setBackupError(errorMessage(cause)); }
    finally { operationRef.current = false; if (mountedRef.current) setBackupBusy(false); }
  };
  const busy = saving || backupBusy;
  return <Dialog title="使用设置" description="设置保存在当前用户的服务器空间中。" onClose={() => { if (!operationRef.current) onClose(); }} wide>
    <div className="settings-tabs" aria-label="设置分类">{([{ id: 'general', label: '画面与声音' }, { id: 'input', label: '按键与触屏' }, { id: 'backup', label: '备份与恢复' }] as const).map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => { setTab(item.id); setBinding(null); }}>{item.label}</button>)}</div>
    {error && <ErrorNotice message={error} onRetry={!settings ? () => setRevision((value) => value + 1) : undefined}/>}
    {!settings && !error ? <Loading label="正在读取设置…"/> : settings && <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {tab === 'general' && <>
        <label className="field-label settings-field">界面外观<select aria-label="界面外观" value={localPrefs.colorScheme} onChange={(event) => applyColorScheme(event.target.value as ColorSchemePreference)}><option value="system">跟随系统（当前{systemDark ? '深色' : '浅色'}）</option><option value="light">浅色模式</option><option value="dark">深色模式</option></select></label>
        <div className="setting-row"><div><label htmlFor="pixelated">像素画面</label><p>保留卡带原始像素边缘，关闭后平滑缩放。</p></div><input className="switch" id="pixelated" type="checkbox" checked={settings.pixelated} onChange={(event) => setSettings({ ...settings, pixelated: event.target.checked })}/></div>
        <div className="setting-row"><div><label htmlFor="crt">显像管效果</label><p>在运行画面上叠加轻微扫描线。</p></div><input className="switch" id="crt" type="checkbox" checked={settings.crt} onChange={(event) => setSettings({ ...settings, crt: event.target.checked })}/></div>
        <div className="setting-row"><div><label htmlFor="auto-pause-blur">窗口失焦自动暂停</label><p>切到其他窗口时自动暂停运行；切换标签页始终自动暂停。</p></div><input className="switch" id="auto-pause-blur" type="checkbox" checked={localPrefs.autoPauseOnBlur} onChange={(event) => setAutoPauseOnBlur(event.target.checked)}/></div>
        <div className="setting-row"><div><label htmlFor="auto-save-exit">离开播放器自动存档</label><p>退出正在游玩的卡带时自动保存画面到槽位 10，方便无电池芯片的经典游戏续玩。</p></div><input className="switch" id="auto-save-exit" type="checkbox" checked={localPrefs.autoSaveOnExit} onChange={(event) => setAutoSaveOnExit(event.target.checked)}/></div>
        <label className="field-label settings-field">画面比例<select value={settings.aspectRatio} onChange={(event) => setSettings({ ...settings, aspectRatio: event.target.value as Settings['aspectRatio'] })}><option value="4:3">经典电视 · 4:3</option><option value="pixel">原始像素 · 8:7</option><option value="stretch">填满画面</option></select></label>
        <div className="setting-row"><div><label htmlFor="muted">默认静音</label><p>运行卡带后也可随时切换。</p></div><input className="switch" id="muted" type="checkbox" checked={settings.muted} onChange={(event) => setSettings({ ...settings, muted: event.target.checked })}/></div>
        <label className="volume-setting" htmlFor="volume"><span>默认音量 <b>{Math.round(settings.volume * 100)}%</b></span><input id="volume" type="range" min="0" max="1" step="0.05" value={settings.volume} disabled={settings.muted} onChange={(event) => setSettings({ ...settings, volume: Number(event.target.value) })}/></label>
      </>}
      {tab === 'input' && <>
        <div className="setting-row"><div><label htmlFor="touch">屏幕手柄</label><p>支持 8 向滑动十字键、连发键与多指同时按住。</p></div><input className="switch" id="touch" type="checkbox" checked={settings.showTouchControls} onChange={(event) => setSettings({ ...settings, showTouchControls: event.target.checked })}/></div>
        <div className="setting-row"><div><label htmlFor="touch-haptics">触屏震动反馈</label><p>在支持震动的移动设备上按下屏幕手柄时给予轻微触感反馈。</p></div><input className="switch" id="touch-haptics" type="checkbox" checked={localPrefs.touchHaptics} onChange={(event) => setTouchHaptics(event.target.checked)}/></div>
        <div className="touch-settings"><label className="volume-setting"><span>按键大小 <b>{Math.round(settings.touchSize * 100)}%</b></span><input type="range" min="0.85" max="1.2" step="0.05" value={settings.touchSize} onChange={(event) => setSettings({ ...settings, touchSize: Number(event.target.value) })}/></label><label className="volume-setting"><span>按键不透明度 <b>{Math.round(settings.touchOpacity * 100)}%</b></span><input type="range" min="0.3" max="1" step="0.05" value={settings.touchOpacity} onChange={(event) => setSettings({ ...settings, touchOpacity: Number(event.target.value) })}/></label></div>
        <label className="field-label settings-field">触屏按键位置<select value={settings.touchPosition} onChange={(event) => setSettings({ ...settings, touchPosition: event.target.value as Settings['touchPosition'] })}><option value="left">整体靠左</option><option value="center">左右均衡</option><option value="right">整体靠右</option></select></label>
        <div className="mapping-heading"><h3>实体键盘映射</h3><button className="text-button" type="button" onClick={() => { setSettings({ ...settings, keyboardMappings: { 1: { ...DEFAULT_MAPPINGS[1] }, 2: { ...DEFAULT_MAPPINGS[2] } } }); setBinding(null); setBindingError(''); }}>恢复默认</button></div>
        <div className="key-presets" role="group" aria-label="快捷键位预设">{KEY_PRESETS.map((preset) => <button key={preset.id} type="button" className="preset-pill" title={preset.summary} onClick={() => { setSettings({ ...settings, keyboardMappings: { 1: { ...preset.mappings[1] }, 2: { ...preset.mappings[2] } } }); setBinding(null); setBindingError(''); }}><strong>{preset.label}</strong><span>{preset.summary}</span></button>)}</div>
        <p className="mapping-intro">点击按键后按下要使用的键，按退出键取消。学习键盘模式按真实键盘布局输入。</p>
        {binding && <div className="notice success" role="status">正在设置玩家 {binding.player} 的“{BUTTON_LABELS[binding.button]}”，请按键…</div>}{bindingError && <ErrorNotice message={bindingError}/>}
        <div className="mapping-grid"><span>功能</span><strong>玩家一</strong><strong>玩家二</strong>{BUTTONS.map((button) => <div className="mapping-row" key={button}><span>{BUTTON_LABELS[button]}</span>{([1, 2] as PlayerNumber[]).map((player) => <button type="button" key={player} className={`mapping-key${binding?.player === player && binding.button === button ? ' capturing' : ''}`} aria-label={`设置玩家 ${player} 的${BUTTON_LABELS[button]}按键，当前 ${keyLabel(settings.keyboardMappings[player][button])}`} onClick={() => { setBinding({ player, button }); setBindingError(''); }}>{keyLabel(settings.keyboardMappings[player][button])}</button>)}</div>)}</div>
        <div className="settings-note"><Icon name="gamepad" size={19}/><span>标准手柄连接后按任意键激活；前两个手柄分别控制 1P 与 2P。左摇杆或十字键控制方向，A/B 对应动作键，X/RB 对应连发 A，Y/LB 对应连发 B。</span></div>
      </>}
      {tab === 'backup' && <div className="backup-settings"><h3>下载备份</h3><p>完整备份包含导入卡带、自定义封面、存档（含缩略图）和设置；如果卡带库较大，可选择仅备份存档、封面与设置，体积更轻、速度更快。</p><div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={() => void backup('full')}><Icon name="load" size={17}/>{backupBusy ? '正在处理…' : '下载备份'}</button><button type="button" className="button secondary" disabled={busy} onClick={() => void backup('saves')}><Icon name="save" size={17}/>仅备份存档与设置</button></div><h3>从备份恢复</h3><p>选择本应用导出的备份。已有存档或封面发生冲突时由服务保留并返回结果。</p><input className="sr-only" type="file" ref={fileRef} accept=".zip,application/zip" tabIndex={-1} onChange={(event) => { setRestoreFile(event.target.files?.[0] || null); setRestoreResult(null); event.target.value = ''; }}/><button type="button" className="button secondary" disabled={busy} onClick={() => fileRef.current?.click()}><Icon name="folder" size={17}/>选择备份文件</button>{restoreFile && <div className="restore-confirm"><p>{restoreFile.name}</p><button type="button" className="button primary" disabled={busy} onClick={() => void restore()}><Icon name="upload" size={17}/>{backupBusy ? '正在恢复…' : '恢复此备份'}</button></div>}{backupError && <ErrorNotice message={backupError}/>} {restoreResult && <div className="restore-result" role="status"><h3>备份恢复完成</h3><p>导入卡带 {restoreResult.importedGames} 张，已有卡带 {restoreResult.existingGames} 张，恢复存档 {restoreResult.restoredSaves} 份{restoreResult.restoredCovers ? `，恢复自定义封面 ${restoreResult.restoredCovers} 张` : ''}。</p><p>{restoreResult.settingsRestored ? '使用设置已恢复。' : '使用设置未更改。'}</p>{restoreResult.conflicts.length > 0 && <><p>有 {restoreResult.conflicts.length} 项发生冲突：</p><ul>{restoreResult.conflicts.map((item, index) => <li key={`${item.id}-${index}`}>{/[\u4e00-\u9fff]/.test(item.message) ? item.message : '已有数据冲突，服务器保留了现有内容。'}<small>{item.id}</small></li>)}</ul></>}</div>}</div>}
      <div className="dialog-footer"><span/><div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button className="button primary" disabled={busy || !!binding}>{saving ? '正在保存…' : '保存设置'}</button></div></div>
    </form>}
  </Dialog>;
}
