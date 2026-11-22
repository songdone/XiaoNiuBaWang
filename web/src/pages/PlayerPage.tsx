import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, ApiError, errorMessage, fetchBytes, type SaveUpload } from '../api/client';
import { downloadBytes } from '../api/download';
import { assertSaveCompatible, snapshotFilename } from '../emulator/saves';
import { SaveSession, bounded } from '../emulator/saveSession';
import { keyLabel, BUTTON_LABELS, BUTTONS } from '../input/mappings';
import { createAdapter, type EmulatorAdapter, type KeyboardDevice } from '../emulator/adapter';
import { InputController } from '../input/controller';
import { usePhysicalInputs } from '../input/usePhysicalInputs';
import { TouchControls } from '../input/TouchControls';
import { LearningKeyboard } from '../input/LearningKeyboard';
import { Icon } from '../components/Icon';
import { ErrorNotice, Loading } from '../components/States';
import { Dialog } from '../components/Dialog';
import { navigate, registerNavigationGuard } from '../hooks/useRoute';
import { usePlayerViewport } from '../hooks/usePlayerViewport';
import { formatDate } from '../format';
import { APP_SHORT_NAME, type Game, type Health, type SaveRecord, type Settings } from '../types';

type Phase = 'loading' | 'ready' | 'running' | 'paused' | 'unavailable' | 'error';
export function PlayerPage({ id, health, settings, onPlayed, onOpenInputSettings, suspended = false }: { id: string; health: Health | null; settings: Settings; onPlayed: () => void; onOpenInputSettings?: () => void; suspended?: boolean }) {
  const [game, setGame] = useState<Game | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unavailable, setUnavailable] = useState('');
  const [coreName, setCoreName] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saves, setSaves] = useState<SaveRecord[]>([]);
  const [savesLoading, setSavesLoading] = useState(true);
  const [savesError, setSavesError] = useState('');
  const [slot, setSlot] = useState(1);
  const [device, setDevice] = useState<KeyboardDevice>('none');
  const [keyboardExpanded, setKeyboardExpanded] = useState(false);
  const [muted, setMuted] = useState(settings.muted);
  const [volume, setVolume] = useState(settings.volume);
  const [audioSupported, setAudioSupported] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [session] = useState(() => new SaveSession(id));
  const [pending, setPending] = useState<SaveUpload | null>(() => session.pending[0] ?? null);
  const [pendingCount, setPendingCount] = useState(session.pending.length);
  const [storageError, setStorageError] = useState(session.storageError);
  const [conflict, setConflict] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const leavingRef = useRef(false);
  const exitResolve = useRef<((leave: boolean) => void) | null>(null);
  const savesRef = useRef<SaveRecord[]>([]);
  savesRef.current = saves;
  const syncPending = useCallback(() => {
    if (!mounted.current) return;
    setPending(session.pending[0] ?? null);
    setPendingCount(session.pending.length);
    setStorageError(session.storageError);
  }, [session]);
  const [input] = useState(() => new InputController());
  const adapterRef = useRef<EmulatorAdapter | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [presentation, setPresentation] = useState<'window' | 'fullscreen' | 'theater'>('window');
  const [touchVisible, setTouchVisible] = useState(settings.showTouchControls);
  const [hintPlayer, setHintPlayer] = useState<1 | 2>(1);
  const [helpOpen, setHelpOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const expanded = presentation !== 'window';
  const viewport = usePlayerViewport(screenRef, viewportRef, expanded, `${touchVisible}:${device}:${keyboardExpanded}:${error}:${notice}:${storageError}:${pendingCount}`);
  const ratio = settings.aspectRatio === 'pixel' ? 8 / 7 : settings.aspectRatio === 'stretch' ? 16 / 9 : 4 / 3;
  const initialCoreRef = useRef(health?.core ?? null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const mounted = useRef(true);
  const ready = ['ready', 'running', 'paused'].includes(phase);
  const inputEnabled = phase === 'running' && !suspended && !resetOpen && !overrideOpen && !exitOpen && !discardOpen && !helpOpen;
  const gamepads = usePhysicalInputs(input, inputEnabled, device !== 'none', settings.keyboardMappings, screenRef);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const refreshSaves = useCallback(async () => {
    setSavesLoading(true); setSavesError('');
    try { const list = await api.saves(id); if (mounted.current) setSaves(list); }
    catch (cause) { if (mounted.current) setSavesError(errorMessage(cause)); }
    finally { if (mounted.current) setSavesLoading(false); }
  }, [id]);

  useEffect(() => {
    const abort = new AbortController();
    let owned: EmulatorAdapter | null = null;
    setPhase('loading'); setError(''); setUnavailable(''); setNotice(''); setDevice('none');
    void (async () => {
      try {
        const current = await api.game(id, abort.signal);
        if (abort.signal.aborted || !canvasRef.current) return;
        setGame(current);
        const result = await createAdapter({ canvas: canvasRef.current, signal: abort.signal, onError: (cause) => {
          input.releaseAll(); setError(cause.message); setPhase('error');
        } }, initialCoreRef.current);
        if (result.status === 'unavailable') { setUnavailable(result.reason); setPhase('unavailable'); return; }
        owned = result.adapter;
        adapterRef.current = owned;
        input.attach(owned);
        setCoreName(owned.name);
        setAudioSupported(owned.capabilities.audio);
        owned.setVolume(settingsRef.current.muted ? 0 : settingsRef.current.volume);
        const launch = await api.launch(id, abort.signal);
        if (!launch.romUrl) throw new Error('服务没有提供可读取的卡带地址。');
        await owned.load(await fetchBytes(launch.romUrl, abort.signal));
        if (abort.signal.aborted) return;
        try {
          const records = await api.saves(id, abort.signal);
          if (abort.signal.aborted) return;
          setSaves(records); setSavesLoading(false);
          const battery = records.find((save) => save.kind === 'sram');
          if (battery) {
            assertSaveCompatible(battery, current, owned);
            const bytes = await api.saveBytes(battery);
            if (abort.signal.aborted) return;
            owned.loadSaveRAM(bytes); session.lastRAM = bytes.slice(); setNotice('已读取卡带电池存档。');
          } else { session.lastRAM = owned.getSaveRAM(); }
        } catch (cause) { if (!abort.signal.aborted) { setSavesError(errorMessage(cause)); setSavesLoading(false); } }
        if (abort.signal.aborted) return;
        setPhase('ready');
      } catch (cause) {
        if (!abort.signal.aborted) { setError(errorMessage(cause)); setPhase('error'); }
      }
    })();
    return () => {
      abort.abort(); input.attach(null);
      if (owned) { if (adapterRef.current === owned) adapterRef.current = null; void owned.destroy(); }
    };
  }, [id, revision, input]);

  useEffect(() => { setVolume(settings.volume); setMuted(settings.muted); }, [settings.volume, settings.muted]);
  useEffect(() => { adapterRef.current?.setVolume(muted ? 0 : volume); }, [muted, volume, phase]);
  useEffect(() => {
    const pause = () => {
      if (phase !== 'running') return;
      input.releaseAll();
      void Promise.resolve(adapterRef.current?.pause()).then(() => { if (mounted.current) { setPhase('paused'); setNotice('已自动暂停，点击继续运行。'); } }).catch((cause) => setError(errorMessage(cause)));
    };
    const visibility = () => { if (document.hidden) pause(); };
    window.addEventListener('blur', pause); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('blur', pause); document.removeEventListener('visibilitychange', visibility); };
  }, [phase, input]);

  const run = async <T,>(task: () => Promise<T> | T): Promise<T | undefined> => {
    if (session.busy) return undefined;
    setBusy(true);
    try { return await session.run(task); }
    finally { if (mounted.current) setBusy(session.busy); syncPending(); }
  };
  const togglePlayback = async () => {
    const adapter = adapterRef.current;
    if (!adapter || !ready || leavingRef.current) return;
    await run(async () => {
      setError(''); setNotice('');
      try {
        if (phase === 'running') { input.releaseAll(); await adapter.pause(); setPhase('paused'); }
        else { await adapter.start(); setPhase('running'); onPlayed(); }
      } catch (cause) { setError(errorMessage(cause)); }
    });
  };
  useEffect(() => {
    if (phase === 'running' && !suspended) canvasRef.current?.focus({ preventScroll: true });
  }, [phase, suspended, presentation]);
  useEffect(() => {
    if (suspended && phase === 'running') {
      input.releaseAll(); void Promise.resolve(adapterRef.current?.pause()).then(() => { if (mounted.current) setPhase('paused'); }).catch((cause) => setError(errorMessage(cause)));
    }
  }, [suspended, phase, input]);
  const leavePresentation = async () => {
    input.releaseAll();
    if (document.fullscreenElement === screenRef.current) await document.exitFullscreen();
    setPresentation('window');
  };
  const togglePresentation = async () => {
    input.releaseAll();
    if (expanded) { await leavePresentation(); return; }
    if (document.fullscreenEnabled && screenRef.current?.requestFullscreen) {
      try { await screenRef.current.requestFullscreen(); setPresentation('fullscreen'); }
      catch { setPresentation('theater'); setNotice('当前环境不允许系统全屏，已切换页内大屏。'); }
    } else setPresentation('theater');
  };
  const openInputSettings = async () => {
    input.releaseAll();
    if (phase === 'running') { await adapterRef.current?.pause(); setPhase('paused'); }
    await leavePresentation();
    onOpenInputSettings?.();
  };
  useEffect(() => { setTouchVisible(settings.showTouchControls); }, [settings.showTouchControls]);
  useEffect(() => {
    const changed = () => {
      input.releaseAll();
      setPresentation((current) => document.fullscreenElement === screenRef.current ? 'fullscreen' : current === 'fullscreen' ? 'window' : current);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.code === 'Escape' && presentation === 'theater' && !document.querySelector('dialog[open]')) {
        event.preventDefault(); input.releaseAll(); setPresentation('window');
      }
    };
    document.addEventListener('fullscreenchange', changed);
    window.addEventListener('keydown', escape);
    return () => { document.removeEventListener('fullscreenchange', changed); window.removeEventListener('keydown', escape); };
  }, [input, presentation]);
  useEffect(() => {
    document.body.classList.toggle('player-presentation-open', expanded);
    return () => document.body.classList.remove('player-presentation-open');
  }, [expanded]);
  useEffect(() => {
    if (!resetOpen && !overrideOpen && !exitOpen && !discardOpen && !helpOpen) return;
    input.releaseAll();
    if (phase === 'running') void Promise.resolve(adapterRef.current?.pause()).then(() => { if (mounted.current) setPhase('paused'); });
  }, [resetOpen, overrideOpen, exitOpen, discardOpen, helpOpen, phase, input]);
  const capture = (kind: 'state' | 'sram', targetSlot = slot): SaveUpload | null => {
    const adapter = adapterRef.current;
    if (!adapter || !game || !ready) return null;
    const bytes = kind === 'state' ? adapter.saveState() : adapter.getSaveRAM();
    if (!bytes.length) return null;
    return { game, kind, slot: kind === 'state' ? targetSlot : 0, core: adapter.name.toLowerCase(), coreVersion: adapter.version, bytes: bytes.slice(), existing: savesRef.current.find((record) => record.kind === kind && (kind === 'sram' || record.slot === targetSlot)) };
  };
  // Caller owns the session mutex. Persist bytes before any network request.
  const uploadSnapshot = async (snapshot: SaveUpload, automatic = false): Promise<boolean> => {
    const retained = session.pending.includes(snapshot) ? snapshot : session.retain(snapshot);
    syncPending(); setError(''); if (!automatic) setNotice('');
    try {
      const record = await api.save(retained);
      if (retained.kind === 'sram') session.lastRAM = retained.bytes.slice();
      session.remove(retained, record);
      savesRef.current = [...savesRef.current.filter((save) => save.id !== record.id && !(save.kind === record.kind && save.slot === record.slot)), record];
      if (mounted.current) {
        setSaves(savesRef.current); setConflict(false);
        if (!automatic) setNotice(retained.kind === 'state' ? `已保存到槽位 ${retained.slot}。` : '电池存档已保存到服务器。');
      }
      return true;
    } catch (cause) {
      if (mounted.current) { setError(`${errorMessage(cause)} 本地快照已保留。`); setConflict(cause instanceof ApiError && [409, 412].includes(cause.status)); }
      return false;
    } finally { syncPending(); }
  };
  const save = async (kind: 'state' | 'sram', automatic = false) => {
    if (session.pending.length || leavingRef.current || savesLoading || savesError) return;
    await run(async () => {
      try {
        const snapshot = capture(kind);
        if (!snapshot) { if (!automatic) setNotice('这张卡带没有可保存的电池存档。'); return; }
        if (automatic && !session.ramChanged(snapshot.bytes)) return;
        await uploadSnapshot(snapshot, automatic);
      } catch (cause) { setError(errorMessage(cause)); }
    });
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (phase !== 'running') return;
    const timer = window.setInterval(() => { void saveRef.current('sram', true); }, 30_000);
    return () => window.clearInterval(timer);
  }, [phase]);
  const retryPending = async (overwrite = false) => run(async () => {
    if (!session.pending.length) return true;
    try {
      if (overwrite) {
        const records = await api.saves(id); savesRef.current = records; setSaves(records);
        session.pending[0].existing = records.find((record) => record.kind === session.pending[0].kind && record.slot === session.pending[0].slot);
        session.persist();
      }
      while (session.pending.length) if (!await uploadSnapshot(session.pending[0])) return false;
      return true;
    } catch (cause) { setError(`${errorMessage(cause)} 本地快照已保留。`); return false; }
  });
  const overwritePending = async () => { setOverrideOpen(false); await retryPending(true); };
  const downloadPending = (remove = false): boolean => {
    try {
      for (const snapshot of [...session.pending]) {
        downloadBytes(snapshot.bytes, snapshotFilename(snapshot));
        if (remove) { if (snapshot.kind === 'sram') session.lastRAM = snapshot.bytes.slice(); session.remove(snapshot); }
      }
      syncPending();
      if (remove) { setConflict(false); setOverrideOpen(false); setNotice('服务器存档未覆盖，本地快照已交给浏览器下载。请核对下载文件。'); }
      return true;
    } catch (cause) { setError(`${errorMessage(cause)} 下载未完成，本地快照仍保留。`); return false; }
  };
  const downloadSnapshot = async () => {
    if (leavingRef.current) return;
    await run(() => {
      try { const snapshot = capture('state'); if (snapshot) { downloadBytes(snapshot.bytes, snapshotFilename(snapshot)); setNotice('当前即时存档已交给浏览器下载。'); } }
      catch (cause) { setError(errorMessage(cause)); }
    });
  };
  const loadSave = async () => {
    const adapter = adapterRef.current;
    const record = savesRef.current.find((save) => save.kind === 'state' && save.slot === slot);
    if (!adapter || !record || !game || session.pending.length || leavingRef.current) return;
    await run(async () => {
      setError(''); setNotice(''); input.releaseAll();
      try {
        assertSaveCompatible(record, game, adapter);
        await adapter.pause(); setPhase('paused');
        adapter.loadState(await api.saveBytes(record)); input.releaseAll(); setNotice(`已读取槽位 ${slot}，点击继续运行。`);
      } catch (cause) { setError(errorMessage(cause)); }
    });
  };
  const reset = async () => {
    const adapter = adapterRef.current;
    if (!adapter || session.pending.length || leavingRef.current) return;
    await run(async () => {
      setError(''); input.releaseAll();
      try { await adapter.pause(); await adapter.reset(); input.releaseAll(); setPhase('paused'); setNotice('卡带已重新启动，点击继续运行。'); setResetOpen(false); }
      catch (cause) { setError(errorMessage(cause)); }
    });
  };
  const retainExitRAM = () => {
    const snapshot = capture('sram');
    if (snapshot && session.ramChanged(snapshot.bytes) && !session.hasLatestRAM(snapshot.bytes)) { session.retain(snapshot); syncPending(); }
  };
  const flushExit = async (): Promise<boolean> => {
    if (!await session.waitIdle()) { setError('保存仍在进行，本地快照已保留。请等待后重试或下载。'); return false; }
    const flushed = await bounded(run(async () => {
      try {
        input.releaseAll(); await adapterRef.current?.pause();
        if (ready) setPhase('paused');
        retainExitRAM();
        if (session.pending.length && (savesLoading || savesError)) { setError('存档列表未就绪，本地快照已保留。请重试读取列表后保存，或下载后离开。'); return false; }
        if (conflict && session.pending.length) return false;
        while (session.pending.length) if (!await uploadSnapshot(session.pending[0])) return false;
        return true;
      } catch (cause) { setError(`${errorMessage(cause)} 请下载进度后再离开。`); return false; }
    }));
    return flushed === true;
  };
  const finishExit = (leave: boolean) => {
    setExitOpen(false); setDiscardOpen(false);
    if (!leave) leavingRef.current = false;
    exitResolve.current?.(leave); exitResolve.current = null;
  };
  const downloadExit = () => {
    // If SRAM capture failed, an empty download action must never approve leaving.
    try {
      retainExitRAM();
      if (!session.pending.length) {
        const snapshot = capture('state');
        if (!snapshot) { setError('无法生成可下载的快照，请留在播放器重试。'); return; }
        session.retain(snapshot); syncPending();
      }
      if (downloadPending(true)) finishExit(true);
    } catch (cause) { setError(`${errorMessage(cause)} 未离开播放器。`); }
  };
  const guardRef = useRef<() => Promise<boolean>>(async () => true);
  guardRef.current = async () => {
    leavingRef.current = true; input.releaseAll();
    if (await flushExit()) return true;
    setExitOpen(true);
    return new Promise<boolean>((resolve) => { exitResolve.current = resolve; });
  };
  useEffect(() => {
    const unregister = registerNavigationGuard(() => guardRef.current());
    return () => { unregister(); exitResolve.current?.(false); exitResolve.current = null; };
  }, []);
  const unloadRef = useRef(() => {});
  unloadRef.current = retainExitRAM;
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      // Only synchronous local retention is possible here. No claim of guaranteed
      // asynchronous server upload on refresh/close; the browser owns that prompt.
      try { unloadRef.current(); } catch { event.preventDefault(); event.returnValue = ''; }
      if (session.pending.length || session.busy) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [session]);
  const selectedSave = saves.find((save) => save.kind === 'state' && save.slot === slot);
  return <div className="player-page">
    <div className="player-heading"><div><button className="back-link" onClick={() => navigate('game', id)}><Icon name="back" size={17}/>卡带详情</button><h1>{game?.title || '正在打开卡带'}</h1></div><div className="player-device-status"><Icon name="gamepad" size={18}/><span>{gamepads.length ? `${gamepads.length} 个手柄已连接` : '键盘 / 触屏'}</span><span className={`status-dot${phase === 'running' ? ' online' : ''}`}/><span>{phase === 'running' ? '运行中' : phase === 'paused' ? '已暂停' : phase === 'ready' ? '准备就绪' : phase === 'unavailable' ? '核心不可用' : phase === 'error' ? '打开失败' : '正在加载'}</span></div></div>
    {error && <ErrorNotice message={error} onRetry={phase === 'error' ? () => setRevision((value) => value + 1) : undefined}/>}
    {notice && <div className="notice success" role="status"><Icon name="check"/><span>{notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" size={16}/></button></div>}
    {storageError && <ErrorNotice message={storageError}/>}
    {pending && <div className="pending-snapshot" role="status"><div><h2>{conflict ? '存档发生冲突，本地进度已保留' : '有一份尚未上传的本地快照'}</h2><p>{pending.kind === 'state' ? `即时存档 · 槽位 ${pending.slot}` : '卡带电池存档'} · 共 {pendingCount} 份。先下载可保留这些进度。</p></div><div className="button-row"><button className="button secondary" onClick={() => downloadPending()}><Icon name="load" size={17}/>下载本地快照</button><button className="button secondary" disabled={busy} onClick={() => { if (conflict) setOverrideOpen(true); else void retryPending(); }}>{conflict ? '处理服务器冲突' : '重试上传'}</button></div></div>}
    <div className="player-layout"><div className={`player-machine${expanded ? ' presentation-expanded' : ''}`} data-presentation={presentation} data-keyboard-device={device} ref={screenRef} onPointerUp={(event) => { if (inputEnabled && event.target instanceof HTMLElement && event.target.closest('[data-input-control]')) canvasRef.current?.focus({ preventScroll: true }); }} style={{ '--player-height': viewport.height ? `${viewport.height}px` : undefined } as CSSProperties}><div className="machine-topline"><span><i/>{APP_SHORT_NAME}</span><span>NES / 玩家一 + 玩家二</span></div><div className="player-viewport" ref={viewportRef}><div className={`player-screen${settings.crt ? ' crt' : ''} ratio-${settings.aspectRatio === 'pixel' ? 'pixel' : settings.aspectRatio === 'stretch' ? 'stretch' : 'tv'}`} style={{ '--screen-ratio': ratio, aspectRatio: ratio } as CSSProperties}>
      <canvas ref={canvasRef} width="256" height="240" data-game-focus className={settings.pixelated ? 'pixelated' : ''} aria-label={`${game?.title || 'NES'} 运行画面`} tabIndex={phase === 'running' ? 0 : -1} onPointerDown={() => { if (phase === 'running') canvasRef.current?.focus({ preventScroll: true }); }}/>
      {phase !== 'running' && <div className={`screen-overlay ${phase === 'paused' || phase === 'ready' ? 'screen-overlay-light' : ''}`}>
        {phase === 'loading' ? <Loading label="正在读取卡带与本地核心…"/> : phase === 'unavailable' ? <><Icon name="cartridge" size={42}/><h2>模拟器核心不可用</h2><p>{unavailable}</p><button className="button secondary" onClick={() => setRevision((value) => value + 1)}><Icon name="refresh" size={17}/>重新检查核心</button></> : phase === 'error' ? <><Icon name="warning" size={42}/><h2>卡带未能启动</h2><p>{error}</p><button className="button secondary" onClick={() => setRevision((value) => value + 1)}>重新打开</button></> : <><button className="screen-play" aria-label={phase === 'ready' ? '开始运行卡带' : '继续运行卡带'} disabled={busy} onClick={() => void togglePlayback()}><Icon name="play" size={30}/></button><h2>{phase === 'ready' ? '卡带已就绪' : '卡带已暂停'}</h2><p>{phase === 'ready' ? '点击开始，开启画面与声音。' : '点击继续，回到刚才的进度。'}</p></>}
      </div>}
    </div></div><div className="playback-toolbar"><div className="toolbar-actions"><button className="icon-button" aria-label={phase === 'running' ? '暂停运行' : '开始或继续运行'} title={phase === 'running' ? '暂停' : '运行'} disabled={!ready || busy} onClick={() => void togglePlayback()}><Icon name={phase === 'running' ? 'pause' : 'play'}/></button><button className="icon-button" aria-label="重置卡带" title="重置卡带" disabled={!ready || busy || !!pending || exitOpen} onClick={() => setResetOpen(true)}><Icon name="reset"/></button><span className="toolbar-divider"/><button className="icon-button" aria-label={muted ? '开启声音' : '静音'} title={muted ? '开启声音' : '静音'} disabled={!ready || !audioSupported} onClick={() => setMuted(!muted)}><Icon name={muted || volume === 0 ? 'mute' : 'volume'}/></button><label className="player-volume"><span className="sr-only">播放器音量</span><input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} disabled={!ready || !audioSupported} onChange={(event) => { setMuted(false); setVolume(Number(event.target.value)); }}/></label></div><div className="presentation-actions"><button className="icon-button" aria-label={touchVisible ? '隐藏屏幕手柄' : '显示屏幕手柄'} title="屏幕手柄" aria-pressed={touchVisible} onClick={() => { input.releaseAll(); setTouchVisible(!touchVisible); }}><Icon name="gamepad"/></button><button className="icon-button" aria-label="查看这张卡带怎么玩" title="怎么玩" onClick={() => setHelpOpen(true)}><Icon name="help"/></button>{onOpenInputSettings && <button className="icon-button" aria-label="按键设置" title="按键设置" disabled={busy} onClick={() => void openInputSettings()}><Icon name="keyboard"/></button>}<button className="icon-button" aria-label={expanded ? '退出全屏或大屏' : '全屏游玩'} title={expanded ? '退出大屏' : '全屏游玩'} disabled={!ready} onClick={() => void togglePresentation().catch((cause) => setError(errorMessage(cause)))}><Icon name={expanded ? 'close' : 'expand'}/></button></div></div>
    <div className="player-key-hints" role="region" aria-label="当前游戏键位"><button className="hint-player" aria-label="切换查看玩家键位" onClick={() => setHintPlayer(hintPlayer === 1 ? 2 : 1)}>{hintPlayer}P 键盘</button>{device === 'none' ? <><span>方向 <kbd>{['up', 'down', 'left', 'right'].map((button) => keyLabel(settings.keyboardMappings[hintPlayer][button as 'up'])).join(' ')}</kbd></span>{(['a', 'b', 'start', 'select'] as const).map((button) => <span key={button}>{BUTTON_LABELS[button]} <kbd>{keyLabel(settings.keyboardMappings[hintPlayer][button])}</kbd></span>)}</> : <span>{device === 'family' ? 'Family' : 'Subor'} 学习键盘 · 点击画面后直接输入</span>}</div>
    {touchVisible && <TouchControls input={input} enabled={inputEnabled} size={settings.touchSize} opacity={settings.touchOpacity} position={settings.touchPosition}/>}
    <div className="presentation-learning"><LearningKeyboard input={input} enabled={inputEnabled && device !== 'none'} expanded={keyboardExpanded} onToggle={() => { input.releaseAll(); setKeyboardExpanded((value) => !value); }}/></div>
    <div className="machine-footer"><span>先点击运行，再按卡带开始键</span><span>{coreName || '等待核心'}</span></div></div>
    <aside className={`player-sidebar${detailsOpen ? ' details-open' : ''}`}><button className="player-details-toggle" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}><Icon name="save" size={18}/>存档与输入设备<Icon name="chevron" size={16}/></button><div className="player-details"><section className="player-panel"><h2><Icon name="save" size={18}/>进度存档</h2><label className="field-label">即时存档槽位<select value={slot} disabled={busy || exitOpen} onChange={(event) => setSlot(Number(event.target.value))}>{[1, 2, 3].map((value) => <option value={value} key={value}>槽位 {value}{saves.some((save) => save.kind === 'state' && save.slot === value) ? ' · 已有存档' : ' · 空'}</option>)}</select></label>{savesLoading ? <p className="small-muted">正在读取存档…</p> : <p className="small-muted">{selectedSave ? `上次保存 ${formatDate(selectedSave.createdAt)}` : '此槽位还没有存档'}</p>}<div className="save-actions"><button className="button secondary" disabled={!ready || busy || !!pending || savesLoading || !!savesError} onClick={() => void save('state')}><Icon name="save" size={17}/>{busy ? '请稍候…' : '保存进度'}</button><button className="button secondary" disabled={!ready || busy || !!pending || !selectedSave} onClick={() => void loadSave()}><Icon name="load" size={17}/>读取进度</button></div><button className="text-button battery-save" disabled={!ready || busy || exitOpen} onClick={() => void downloadSnapshot()}>下载当前即时存档</button><button className="text-button battery-save" disabled={!ready || busy || !!pending || savesLoading || !!savesError} onClick={() => void save('sram')}>保存卡带电池存档</button>{savesError && <ErrorNotice message={savesError} onRetry={() => void refreshSaves()}/>}<p className="panel-note">即时存档记录画面状态。支持电池存档的卡带每 30 秒保存一次变更；冲突时保留本地快照。</p></section>
    <section className="player-panel"><h2><Icon name="keyboard" size={18}/>输入设备</h2><label className="field-label">学习键盘设备<select value={device} disabled={!ready || busy} onChange={(event) => { const value = event.target.value as KeyboardDevice; input.releaseAll(); adapterRef.current?.setKeyboardDevice(value); setDevice(value); if (value !== 'none') setKeyboardExpanded(true); }}><option value="none">游戏手柄模式</option><option value="family">任天堂家庭电脑键盘（Family）</option><option value="subor">小霸王学习键盘（Subor）</option></select></label><div className="keyboard-map"><span>方向</span><kbd>{['up', 'down', 'left', 'right'].map((button) => keyLabel(settings.keyboardMappings[1][button as 'up'])).join(' ')}</kbd><span>A / B</span><kbd>{keyLabel(settings.keyboardMappings[1].a)} / {keyLabel(settings.keyboardMappings[1].b)}</kbd><span>开始</span><kbd>{keyLabel(settings.keyboardMappings[1].start)}</kbd><span>选择</span><kbd>{keyLabel(settings.keyboardMappings[1].select)}</kbd></div><p className="panel-note">学习模式会把实体键盘输入发送给卡带。切回手柄模式恢复游戏快捷键。</p>{gamepads.length > 0 && <p className="connected-gamepads">{gamepads.map((name, index) => <span key={`${name}-${index}`}>{index + 1}P · {name}</span>)}</p>}</section></div></aside></div>
    {game?.controls && <section className="game-controls-help"><h2>这张卡带怎么玩</h2><p>{game.controls}</p><span>上文按默认键位说明；自定义键位以“使用设置”与上方按键图为准。</span></section>}
    {helpOpen && <Dialog title="这张卡带怎么玩" onClose={() => setHelpOpen(false)}><p className="player-help-copy">先点击运行按钮开启画面与声音，再按卡带的开始或确认键进入游戏。下面的操作描述使用默认键位，自定义按键以当前键位表为准。</p>{game?.controls && <p className="player-help-copy">{game.controls}</p>}<div className="player-help-mappings">{([1, 2] as const).map((player) => <section key={player}><h3>玩家 {player}</h3>{BUTTONS.map((button) => <div key={button}><span>{BUTTON_LABELS[button]}</span><kbd>{keyLabel(settings.keyboardMappings[player][button])}</kbd></div>)}</section>)}</div></Dialog>}
    {overrideOpen && pending && <Dialog title="处理存档冲突" description="服务器中已有其他进度。保留两份会下载本地快照并保留服务器原存档；更新服务器会重新读取版本，仍按版本条件写入。" onClose={() => { if (!busy) setOverrideOpen(false); }}><div className="dialog-footer"><span/><div className="button-row"><button className="button secondary" disabled={busy} onClick={() => downloadPending(true)}>保留两份，下载本地</button><button className="button primary" disabled={busy} onClick={() => void overwritePending()}>用本地进度更新服务器</button></div></div></Dialog>}
    {exitOpen && <Dialog title="离开前保留进度" description="尚有本地进度未上传。重试成功后才能安全离开；也可下载本地快照保留服务器原存档，或明确确认丢弃。刷新或关闭页面不保证完成服务器上传。" onClose={() => finishExit(false)}><div className="dialog-footer"><span/><div className="button-row"><button className="button secondary" onClick={() => finishExit(false)}>留在播放器</button><button className="button secondary" disabled={busy} onClick={() => { void flushExit().then((ok) => { if (ok) finishExit(true); }); }}>保存 / 重试后离开</button>{conflict && <button className="button secondary" disabled={busy} onClick={() => setOverrideOpen(true)}>处理服务器冲突</button>}<button className="button secondary" disabled={busy} onClick={downloadExit}>下载快照并离开</button><button className="button primary" disabled={busy} onClick={() => setDiscardOpen(true)}>丢弃并离开…</button></div></div></Dialog>}
    {discardOpen && <Dialog title="确认丢弃本地进度" description="此操作不可撤销。尚未上传的本地快照将删除，服务器已有存档不会改变。" onClose={() => setDiscardOpen(false)}><div className="dialog-footer"><span/><div className="button-row"><button className="button secondary" onClick={() => setDiscardOpen(false)}>取消</button><button className="button primary" disabled={busy} onClick={() => { session.discard(); syncPending(); finishExit(true); }}>确认丢弃并离开</button></div></div></Dialog>}
    {resetOpen && <Dialog title="重新启动卡带" description="尚未保存的进度会丢失，已保存的服务器存档会保留。" onClose={() => { if (!busy) setResetOpen(false); }}><div className="dialog-footer"><span/><div className="button-row"><button className="button secondary" disabled={busy} onClick={() => setResetOpen(false)}>取消</button><button className="button primary" disabled={busy} onClick={() => void reset()}>{busy ? '正在重置…' : '重新启动'}</button></div></div></Dialog>}
  </div>;
}
