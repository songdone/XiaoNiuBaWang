import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, ApiError, errorMessage, fetchBytes, type SaveUpload } from '../api/client';
import { downloadBytes } from '../api/download';
import { assertSaveCompatible, snapshotFilename } from '../emulator/saves';
import { SaveSession, bounded } from '../emulator/saveSession';
import { applyGameGeniePatches, loadGameCheats, parseCheatCode, saveGameCheats, type CheatEntry } from '../emulator/gameGenie';
import { RewindBuffer } from '../emulator/rewind';
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
import { setAutoSaveOnExit, useLocalPreferences } from '../preferences';
import { APP_NAME, APP_SHORT_NAME, type Game, type Health, type SaveRecord, type Settings } from '../types';

type Phase = 'loading' | 'ready' | 'running' | 'paused' | 'unavailable' | 'error';
const SAVE_SLOTS = Array.from({ length: 10 }, (_, index) => index + 1);
const SHORTCUT_BLOCKED_TARGET = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const INTERACTIVE_START_BLOCK = 'button, a, input, textarea, select, [role="button"], [contenteditable]:not([contenteditable="false"])';

async function canvasToPngBytes(canvas: HTMLCanvasElement, timeoutMs = 1500): Promise<Uint8Array | null> {
  if (typeof canvas.toBlob === 'function') {
    const isJsdomStub = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)
      && String(canvas.toBlob).includes('implSymbol');
    if (!isJsdomStub) {
      const blob = await new Promise<Blob | null>((resolve) => {
        let settled = false;
        const done = (value: Blob | null) => { if (!settled) { settled = true; resolve(value); } };
        const timer = window.setTimeout(() => done(null), timeoutMs);
        try {
          canvas.toBlob((value) => { window.clearTimeout(timer); done(value); }, 'image/png');
        } catch {
          window.clearTimeout(timer);
          done(null);
        }
      });
      if (blob && blob.size > 0) {
        if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
        return new Promise<Uint8Array>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
          reader.onerror = () => reject(reader.error ?? new Error('无法读取画面数据。'));
          reader.readAsArrayBuffer(blob);
        });
      }
    }
  }
  if (typeof canvas.toDataURL === 'function') {
    const isJsdomStub = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)
      && String(canvas.toDataURL).includes('implSymbol');
    if (!isJsdomStub) {
      const url = canvas.toDataURL('image/png');
      const comma = url.indexOf(',');
      if (comma > 0) {
        const binary = atob(url.slice(comma + 1));
        if (!binary.length) return null;
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
        return out;
      }
    }
  }
  return null;
}

export function PlayerPage({ id, initialSlot, health, settings, onPlayed, onOpenInputSettings, onSettingsChange, onCoverUpdated, onRenamed, suspended = false }: {
  id: string; initialSlot?: number; health: Health | null; settings: Settings; onPlayed: () => void; onOpenInputSettings?: () => void; onSettingsChange?: (settings: Settings) => void; onCoverUpdated?: () => void; onRenamed?: () => void; suspended?: boolean;
}) {
  const localPrefs = useLocalPreferences();
  const [game, setGame] = useState<Game | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unavailable, setUnavailable] = useState('');
  const [coreName, setCoreName] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [saves, setSaves] = useState<SaveRecord[]>([]);
  const [savesLoading, setSavesLoading] = useState(true);
  const [savesError, setSavesError] = useState('');
  const [slot, setSlot] = useState(() => initialSlot && initialSlot >= 1 && initialSlot <= 10 ? initialSlot : 1);
  const [device, setDevice] = useState<KeyboardDevice>('none');
  const [keyboardExpanded, setKeyboardExpanded] = useState(false);
  const [muted, setMuted] = useState(settings.muted);
  const [volume, setVolume] = useState(settings.volume);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [audioSupported, setAudioSupported] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteSaveOpen, setDeleteSaveOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const [renameError, setRenameError] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [displayMenuOpen, setDisplayMenuOpen] = useState(false);
  const [cheatsOpen, setCheatsOpen] = useState(false);
  const [cheats, setCheats] = useState<CheatEntry[]>([]);
  const [cheatCodeInput, setCheatCodeInput] = useState('');
  const [cheatLabelInput, setCheatLabelInput] = useState('');
  const [cheatError, setCheatError] = useState('');
  const [cheatsDirty, setCheatsDirty] = useState(false);
  const [rewindCount, setRewindCount] = useState(0);
  const [canvasFocused, setCanvasFocused] = useState(false);
  const rawRomRef = useRef<Uint8Array | null>(null);
  const rewindRef = useRef<RewindBuffer>(new RewindBuffer(12));
  const [session] = useState(() => new SaveSession(id));
  const [pending, setPending] = useState<SaveUpload | null>(() => session.pending[0] ?? null);
  const [pendingCount, setPendingCount] = useState(session.pending.length);
  const [storageError, setStorageError] = useState(session.storageError);
  const [conflict, setConflict] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const leavingRef = useRef(false);
  const playedNotifiedRef = useRef(false);
  const audioSaveTimerRef = useRef<number | null>(null);
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hintPlayer, setHintPlayer] = useState<1 | 2>(1);
  const [helpOpen, setHelpOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const expanded = presentation !== 'window';
  const viewport = usePlayerViewport(screenRef, viewportRef, expanded, `${touchVisible}:${device}:${keyboardExpanded}:${sidebarCollapsed}:${error}:${storageError}:${pendingCount}`);
  const ratio = settings.aspectRatio === 'pixel' ? 8 / 7 : settings.aspectRatio === 'stretch' ? 16 / 9 : 4 / 3;
  const initialCoreRef = useRef(health?.core ?? null);
  const initialSlotRef = useRef(initialSlot);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onSettingsChangeRef = useRef(onSettingsChange);
  onSettingsChangeRef.current = onSettingsChange;
  const mounted = useRef(true);
  const ready = ['ready', 'running', 'paused'].includes(phase);
  const modalOpen = resetOpen || overrideOpen || exitOpen || discardOpen || helpOpen || deleteSaveOpen || renameOpen || cheatsOpen;
  const inputEnabled = phase === 'running' && !suspended && !modalOpen;
  const gamepads = usePhysicalInputs(input, inputEnabled, device !== 'none', settings.keyboardMappings, screenRef, canvasRef);
  const focusCanvas = useCallback(() => {
    canvasRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (audioSaveTimerRef.current !== null) window.clearTimeout(audioSaveTimerRef.current);
    };
  }, []);
  useEffect(() => {
    if (game?.title) document.title = `${game.title} · ${APP_NAME}`;
    return () => { document.title = `${APP_NAME} · 我的卡带库`; };
  }, [game?.title]);

  const refreshSaves = useCallback(async () => {
    setSavesLoading(true); setSavesError('');
    try { const list = await api.saves(id); if (mounted.current) setSaves(list); }
    catch (cause) { if (mounted.current) setSavesError(errorMessage(cause)); }
    finally { if (mounted.current) setSavesLoading(false); }
  }, [id]);

  useEffect(() => {
    const abort = new AbortController();
    let owned: EmulatorAdapter | null = null;
    playedNotifiedRef.current = false;
    setPhase('loading'); setError(''); setUnavailable(''); setNotice(''); setDevice('none'); setSpeed(1);
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
        const rawRom = await fetchBytes(launch.romUrl, abort.signal);
        if (abort.signal.aborted) return;
        rawRomRef.current = rawRom;
        rewindRef.current.clear();
        setRewindCount(0);
        const storedCheats = loadGameCheats(current.sha256 || current.id);
        setCheats(storedCheats);
        setCheatsDirty(false);
        const patched = applyGameGeniePatches(rawRom, storedCheats);
        await owned.load(patched.bytes);
        owned.setRamCheats?.(patched.ramLocks);
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
          const targetSlot = initialSlotRef.current;
          if (targetSlot) {
            const requested = records.find((save) => save.kind === 'state' && save.slot === targetSlot);
            if (requested) {
              assertSaveCompatible(requested, current, owned);
              const stateBytes = await api.saveBytes(requested);
              if (abort.signal.aborted) return;
              owned.loadState(stateBytes);
              setNotice(`已载入槽位 ${targetSlot}，点击或按 Enter 继续运行。`);
            }
          }
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
  useEffect(() => { adapterRef.current?.setSpeed?.(phase === 'running' ? speed : 1); }, [speed, phase]);
  const scheduleSettingsPersist = (patch: Partial<Settings>) => {
    const next: Settings = { ...settingsRef.current, ...patch };
    onSettingsChangeRef.current?.(next);
    if (audioSaveTimerRef.current !== null) window.clearTimeout(audioSaveTimerRef.current);
    audioSaveTimerRef.current = window.setTimeout(() => {
      audioSaveTimerRef.current = null;
      void api.updateSettings({ ...settingsRef.current, ...patch }).catch(() => { /* Best-effort preference sync. */ });
    }, 450);
  };
  const updateAudio = (nextVolume: number, nextMuted: boolean) => {
    setVolume(nextVolume);
    setMuted(nextMuted);
    scheduleSettingsPersist({ volume: nextVolume, muted: nextMuted });
  };
  const updateDisplay = (patch: Partial<Pick<Settings, 'aspectRatio' | 'pixelated' | 'crt'>>) => {
    scheduleSettingsPersist(patch);
  };
  useEffect(() => {
    const pause = () => {
      if (phase !== 'running') return;
      input.releaseAll(); setSpeed(1);
      void Promise.resolve(adapterRef.current?.pause()).then(() => { if (mounted.current) { setPhase('paused'); setNotice('已自动暂停，点击或按 Enter 继续运行。'); } }).catch((cause) => setError(errorMessage(cause)));
    };
    const onBlur = () => {
      input.releaseAll();
      if (localPrefs.autoPauseOnBlur) pause();
    };
    const visibility = () => { if (document.hidden) pause(); };
    window.addEventListener('blur', onBlur); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('blur', onBlur); document.removeEventListener('visibilitychange', visibility); };
  }, [phase, input, localPrefs.autoPauseOnBlur]);

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
        if (phase === 'running') { input.releaseAll(); setSpeed(1); await adapter.pause(); setPhase('paused'); }
        else {
          await adapter.start(); setPhase('running');
          if (!playedNotifiedRef.current) { playedNotifiedRef.current = true; onPlayed(); }
        }
      } catch (cause) { setError(errorMessage(cause)); }
    });
  };
  const toggleSpeed = useCallback(() => {
    if (!ready || leavingRef.current) return;
    setSpeed((current) => current === 1 ? 2 : 1);
  }, [ready]);
  useEffect(() => {
    if (phase === 'running' && !suspended) {
      focusCanvas();
      setCanvasFocused(document.activeElement === canvasRef.current);
    } else {
      setCanvasFocused(false);
    }
  }, [phase, suspended, presentation, focusCanvas]);
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
    if (!modalOpen) return;
    input.releaseAll(); setSpeed(1);
    if (phase === 'running') void Promise.resolve(adapterRef.current?.pause()).then(() => { if (mounted.current) setPhase('paused'); });
  }, [modalOpen, phase, input]);
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
      if (retained.kind === 'state' && canvasRef.current) {
        const canvas = canvasRef.current;
        void (async () => {
          try {
            const thumbBytes = await canvasToPngBytes(canvas);
            if (!thumbBytes || !thumbBytes.length) return;
            const withThumb = await api.uploadSaveThumb(record.id, thumbBytes);
            if (withThumb && mounted.current) {
              savesRef.current = savesRef.current.map((item) => item.id === withThumb.id ? withThumb : item);
              setSaves(savesRef.current);
            }
          } catch { /* Best-effort thumbnail upload never affects the committed save. */ }
        })();
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
  const loadSave = async (autoResume = false) => {
    const adapter = adapterRef.current;
    const record = savesRef.current.find((save) => save.kind === 'state' && save.slot === slot);
    if (!adapter || !record || !game || session.pending.length || leavingRef.current) return;
    const wasRunning = phase === 'running';
    await run(async () => {
      setError(''); setNotice(''); input.releaseAll(); setSpeed(1);
      try {
        assertSaveCompatible(record, game, adapter);
        await adapter.pause(); setPhase('paused');
        adapter.loadState(await api.saveBytes(record)); input.releaseAll();
        rewindRef.current.clear(); setRewindCount(0);
        if (autoResume && wasRunning) {
          await adapter.start(); setPhase('running'); setNotice(`已快速读取槽位 ${slot}。`);
        } else {
          setNotice(`已读取槽位 ${slot}，点击继续运行。`);
        }
      } catch (cause) { setError(errorMessage(cause)); }
    });
  };
  const deleteSelectedSave = async () => {
    const record = savesRef.current.find((save) => save.kind === 'state' && save.slot === slot);
    if (!record || session.pending.length || leavingRef.current) return;
    await run(async () => {
      setError(''); setNotice('');
      try {
        await api.deleteSave(record);
        savesRef.current = savesRef.current.filter((item) => item.id !== record.id);
        if (mounted.current) {
          setSaves(savesRef.current);
          setDeleteSaveOpen(false);
          setNotice(`已删除槽位 ${slot} 的存档。`);
        }
      } catch (cause) { setError(errorMessage(cause)); }
    });
  };
  const reset = async () => {
    const adapter = adapterRef.current;
    if (!adapter || session.pending.length || leavingRef.current) return;
    await run(async () => {
      setError(''); input.releaseAll(); setSpeed(1);
      try { await adapter.pause(); await adapter.reset(); input.releaseAll(); rewindRef.current.clear(); setRewindCount(0); setPhase('paused'); setNotice('卡带已重新启动，点击继续运行。'); setResetOpen(false); }
      catch (cause) { setError(errorMessage(cause)); }
    });
  };
  const takeScreenshot = async () => {
    if (!canvasRef.current || !game || !ready) return;
    try {
      const bytes = await canvasToPngBytes(canvasRef.current);
      if (!bytes || !bytes.length) throw new Error('无法读取当前游戏画面。');
      downloadBytes(bytes, `${game.title}-截图.png`, 'image/png');
      setNotice('已保存当前画面截图。');
    } catch (cause) { setError(errorMessage(cause)); }
  };
  const setCurrentFrameAsCover = async () => {
    if (!canvasRef.current || !game || game.source !== 'imported' || !ready || coverBusy) return;
    setCoverBusy(true); setError('');
    try {
      const bytes = await canvasToPngBytes(canvasRef.current);
      if (!bytes || !bytes.length) throw new Error('无法读取当前游戏画面。');
      const updated = await api.uploadCover(game.id, bytes);
      if (mounted.current) {
        setGame(updated);
        onCoverUpdated?.();
        setNotice('已将当前画面设为卡带封面。');
      }
    } catch (cause) { if (mounted.current) setError(errorMessage(cause)); }
    finally { if (mounted.current) setCoverBusy(false); }
  };
  useEffect(() => {
    if (phase !== 'running' || modalOpen) return;
    const timer = window.setInterval(() => {
      if (session.busy || leavingRef.current) return;
      const adapter = adapterRef.current;
      if (!adapter) return;
      try {
        const snap = adapter.saveState();
        if (snap.length) {
          rewindRef.current.push(snap);
          if (mounted.current) setRewindCount(rewindRef.current.size);
        }
      } catch { /* Ignore transient rewind sample errors. */ }
    }, 500);
    return () => window.clearInterval(timer);
  }, [phase, modalOpen, session]);

  const triggerRewind = useCallback(() => {
    const adapter = adapterRef.current;
    if (!adapter || !ready || leavingRef.current || session.busy) return;
    const snap = rewindRef.current.pop();
    setRewindCount(rewindRef.current.size);
    if (!snap) {
      setNotice('暂无可回溯的画面。');
      return;
    }
    try {
      adapter.loadState(snap);
      input.releaseAll();
      setNotice(`已回溯画面（还可回溯 ${rewindRef.current.size} 步）。`);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [ready, session, input]);

  const loadSaveRef = useRef(loadSave);
  loadSaveRef.current = loadSave;
  const togglePlaybackRef = useRef(togglePlayback);
  togglePlaybackRef.current = togglePlayback;
  const rewindCallbackRef = useRef(triggerRewind);
  rewindCallbackRef.current = triggerRewind;
  useEffect(() => {
    if (!ready || device !== 'none' || suspended || modalOpen) return;
    const onShortcut = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      const target = event.target instanceof Element ? event.target : document.activeElement;
      if (target instanceof Element && target.closest(SHORTCUT_BLOCKED_TARGET)) return;
      if ((phase === 'ready' || phase === 'paused') && (event.code === 'Enter' || event.code === 'Space')) {
        if (target instanceof Element && target.closest(INTERACTIVE_START_BLOCK)) return;
        event.preventDefault();
        void togglePlaybackRef.current();
        return;
      }
      if (event.code === 'F5') { event.preventDefault(); void saveRef.current('state'); }
      else if (event.code === 'F8') { event.preventDefault(); void loadSaveRef.current(true); }
      else if (event.code === 'F9') { event.preventDefault(); toggleSpeed(); }
      else if (event.code === 'Pause') { event.preventDefault(); void togglePlaybackRef.current(); }
      else if (event.code === 'Backspace' && phase === 'running') {
        const mapped = Object.values(settingsRef.current.keyboardMappings[1]).includes('Backspace')
          || Object.values(settingsRef.current.keyboardMappings[2]).includes('Backspace');
        if (!mapped && !(target instanceof Element && target.closest(INTERACTIVE_START_BLOCK))) {
          event.preventDefault();
          rewindCallbackRef.current();
        }
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [ready, phase, device, suspended, modalOpen, toggleSpeed]);
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
        if (localPrefs.autoSaveOnExit && playedNotifiedRef.current && ready && !savesLoading && !savesError && !session.pending.length) {
          const autoSnap = capture('state', 10);
          if (autoSnap) await uploadSnapshot(autoSnap, true);
        }
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
  const openRenameDialog = () => {
    if (!game || game.source !== 'imported') return;
    setRenameTitle(game.title);
    setRenameError('');
    setRenameOpen(true);
  };
  const submitRename = async () => {
    const trimmed = renameTitle.trim();
    if (!trimmed || !game || renameBusy) return;
    setRenameBusy(true); setRenameError('');
    try {
      await api.rename(id, trimmed);
      if (mounted.current) {
        setGame({ ...game, title: trimmed });
        setRenameOpen(false);
        setNotice(`已重命名为“${trimmed}”。`);
        onRenamed?.();
      }
    } catch (cause) {
      if (mounted.current) setRenameError(errorMessage(cause));
    } finally {
      if (mounted.current) setRenameBusy(false);
    }
  };
  const cheatGameKey = game?.sha256 || game?.id || id;
  const activeCheatCount = cheats.filter((item) => item.enabled).length;
  const updateCheats = (next: CheatEntry[], markRomDirty: boolean) => {
    setCheats(next);
    saveGameCheats(cheatGameKey, next);
    const ramLocks = next
      .filter((item) => item.enabled)
      .flatMap((item) => {
        try {
          const parsed = parseCheatCode(item.code);
          return parsed.kind === 'ram' ? [{ address: parsed.address, value: parsed.value }] : [];
        } catch { return []; }
      });
    adapterRef.current?.setRamCheats?.(ramLocks);
    if (markRomDirty) setCheatsDirty(true);
  };
  const addCheat = () => {
    setCheatError('');
    try {
      const parsed = parseCheatCode(cheatCodeInput);
      const duplicate = cheats.some((item) => item.code === parsed.code);
      if (duplicate) { setCheatError('此金手指代码已在列表中。'); return; }
      const entry: CheatEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        code: parsed.code,
        label: cheatLabelInput.trim() || (parsed.kind === 'ram' ? `内存锁定 ${parsed.code}` : `Game Genie ${parsed.code}`),
        enabled: true,
      };
      updateCheats([...cheats, entry], parsed.kind === 'gg');
      setCheatCodeInput('');
      setCheatLabelInput('');
      if (parsed.kind === 'ram') setNotice(`已实时启用内存锁 ${parsed.code}。`);
    } catch (cause) {
      setCheatError(errorMessage(cause));
    }
  };
  const toggleCheat = (entryId: string) => {
    const target = cheats.find((item) => item.id === entryId);
    if (!target) return;
    let isGG = false;
    try { isGG = parseCheatCode(target.code).kind === 'gg'; } catch { isGG = false; }
    updateCheats(cheats.map((item) => item.id === entryId ? { ...item, enabled: !item.enabled } : item), isGG);
  };
  const removeCheat = (entryId: string) => {
    const target = cheats.find((item) => item.id === entryId);
    if (!target) return;
    let isGG = false;
    try { isGG = target.enabled && parseCheatCode(target.code).kind === 'gg'; } catch { isGG = false; }
    updateCheats(cheats.filter((item) => item.id !== entryId), isGG);
  };
  const applyGameGenieAndReload = async (preserveState: boolean) => {
    const adapter = adapterRef.current;
    const rawRom = rawRomRef.current;
    if (!adapter || !rawRom || !ready) return;
    await run(async () => {
      setError(''); setCheatError('');
      try {
        const prevState = preserveState ? adapter.saveState() : null;
        const prevRAM = adapter.getSaveRAM();
        const patched = applyGameGeniePatches(rawRom, cheats);
        await adapter.load(patched.bytes);
        adapter.setRamCheats?.(patched.ramLocks);
        if (prevRAM.length) {
          try { adapter.loadSaveRAM(prevRAM); } catch { /* Ignore if ROM has no SRAM. */ }
        }
        if (prevState && prevState.length) {
          try { adapter.loadState(prevState); } catch { /* Fall back to fresh boot if state rejected. */ }
        }
        rewindRef.current.clear(); setRewindCount(0);
        setCheatsDirty(false);
        setCheatsOpen(false);
        setNotice(preserveState
          ? `金手指已生效（已修改 ${patched.patchedBytes} 处 ROM 指令，点击继续运行）。`
          : `金手指已生效并重启卡带（已修改 ${patched.patchedBytes} 处 ROM 指令）。`);
      } catch (cause) {
        setCheatError(errorMessage(cause));
      }
    });
  };
  const selectedSave = saves.find((save) => save.kind === 'state' && save.slot === slot);
  const p1 = settings.keyboardMappings[1];
  const returnFocusAfterClick = (event: { detail: number }) => {
    if (event.detail > 0 && phase === 'running') focusCanvas();
  };
  return <div className="player-page">
    <div className="player-heading"><div><button className="back-link" onClick={() => navigate('game', id)}><Icon name="back" size={17}/>卡带详情</button><div className="player-title-row"><h1>{game?.title || '正在打开卡带'}</h1>{game?.source === 'imported' && <button type="button" className="icon-button title-edit-button" aria-label="重命名卡带" title="重命名卡带" disabled={busy || renameBusy} onClick={openRenameDialog}><Icon name="edit" size={17}/></button>}</div></div><div className="player-device-status"><Icon name="gamepad" size={18}/><span>{gamepads.length ? `${gamepads.length} 个手柄已连接` : '键盘 / 触屏'}</span><span className={`status-dot${phase === 'running' ? ' online' : ''}`}/><span>{phase === 'running' ? '运行中' : phase === 'paused' ? '已暂停' : phase === 'ready' ? '准备就绪' : phase === 'unavailable' ? '核心不可用' : phase === 'error' ? '打开失败' : '正在加载'}</span></div></div>
    {error && <ErrorNotice message={error} onRetry={phase === 'error' ? () => setRevision((value) => value + 1) : undefined}/>}
    {storageError && <ErrorNotice message={storageError}/>}
    {pending && <div className="pending-snapshot" role="status"><div><h2>{conflict ? '存档发生冲突，本地进度已保留' : '有一份尚未上传的本地快照'}</h2><p>{pending.kind === 'state' ? `即时存档 · 槽位 ${pending.slot}` : '卡带电池存档'} · 共 {pendingCount} 份。先下载可保留这些进度。</p></div><div className="button-row"><button className="button secondary" onClick={() => downloadPending()}><Icon name="load" size={17}/>下载本地快照</button><button className="button secondary" disabled={busy} onClick={() => { if (conflict) setOverrideOpen(true); else void retryPending(); }}>{conflict ? '处理服务器冲突' : '重试上传'}</button></div></div>}
    <div className={`player-layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}><div className={`player-machine${expanded ? ' presentation-expanded' : ''}`} data-presentation={presentation} data-keyboard-device={device} ref={screenRef} onPointerUp={(event) => { if (inputEnabled && event.target instanceof HTMLElement && event.target.closest('[data-input-control]')) focusCanvas(); }} style={{ '--player-height': viewport.height ? `${viewport.height}px` : undefined } as CSSProperties}><div className="machine-topline"><span><i/>{APP_SHORT_NAME}</span><span>NES / 玩家一 + 玩家二</span></div><div className="player-viewport" ref={viewportRef} onPointerDown={(event) => { if (phase === 'running' && !(event.target instanceof Element && event.target.closest('button'))) focusCanvas(); }}><div className={`player-screen${settings.crt ? ' crt' : ''} ratio-${settings.aspectRatio === 'pixel' ? 'pixel' : settings.aspectRatio === 'stretch' ? 'stretch' : 'tv'}`} style={{ '--screen-ratio': ratio, aspectRatio: ratio } as CSSProperties}>
      <canvas ref={canvasRef} width="256" height="240" data-game-focus className={settings.pixelated ? 'pixelated' : ''} aria-label={`${game?.title || 'NES'} 运行画面`} tabIndex={phase === 'running' ? 0 : -1} onFocus={() => setCanvasFocused(true)} onBlur={() => setCanvasFocused(false)} onPointerDown={() => { if (phase === 'running') focusCanvas(); }}/>
      {notice && <div className="player-hud-toast" role="status"><Icon name="check" size={15}/><span>{notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" size={14}/></button></div>}
      {phase !== 'running' && <div className={`screen-overlay ${phase === 'paused' || phase === 'ready' ? 'screen-overlay-light' : ''}`}>
        {phase === 'loading' ? <Loading label="正在读取卡带与本地核心…"/> : phase === 'unavailable' ? <><Icon name="cartridge" size={42}/><h2>模拟器核心不可用</h2><p>{unavailable}</p><button className="button secondary" onClick={() => setRevision((value) => value + 1)}><Icon name="refresh" size={17}/>重新检查核心</button></> : phase === 'error' ? <><Icon name="warning" size={42}/><h2>卡带未能启动</h2><p>{error}</p><button className="button secondary" onClick={() => setRevision((value) => value + 1)}>重新打开</button></> : <><button className="screen-play" aria-label={phase === 'ready' ? '开始运行卡带' : '继续运行卡带'} disabled={busy} onClick={() => void togglePlayback()}><Icon name="play" size={30}/></button><h2>{phase === 'ready' ? '卡带已就绪' : '卡带已暂停'}</h2><p>{phase === 'ready' ? '点击或按 Enter 开始，开启画面与声音。' : '点击或按 Enter 继续，回到刚才的进度。'}</p></>}
      </div>}
    </div></div><div className="playback-toolbar"><div className="toolbar-actions"><button className="icon-button" aria-label={phase === 'running' ? '暂停运行' : '开始或继续运行'} title={phase === 'running' ? '暂停 (Pause)' : '运行 (Pause)'} disabled={!ready || busy} onClick={() => void togglePlayback()}><Icon name={phase === 'running' ? 'pause' : 'play'}/></button><button className="icon-button" aria-label="重置卡带" title="重置卡带" disabled={!ready || busy || !!pending || exitOpen} onClick={() => setResetOpen(true)}><Icon name="reset"/></button><button className="icon-button" aria-label="时光回溯" title={rewindCount ? `时光回溯 (Backspace · 剩余 ${rewindCount} 步)` : '时光回溯 (运行后每 0.5 秒自动记录)'} disabled={!ready || busy || rewindCount === 0} onClick={(event) => { triggerRewind(); returnFocusAfterClick(event); }}><Icon name="rewind"/></button><button className={`icon-button speed-button${speed > 1 ? ' active' : ''}`} aria-label={speed > 1 ? '恢复正常速度' : '开启 2 倍快进'} title={speed > 1 ? '正常速度 (F9)' : '2 倍快进 (F9)'} aria-pressed={speed > 1} disabled={!ready || busy} onClick={(event) => { toggleSpeed(); returnFocusAfterClick(event); }}>2×</button><button className="icon-button" aria-label="截取游戏画面" title="保存当前画面截图 (PNG)" disabled={!ready || busy} onClick={(event) => { void takeScreenshot(); returnFocusAfterClick(event); }}><Icon name="camera"/></button>{game?.source === 'imported' && <button className="icon-button" aria-label="设为卡带封面" title="将当前画面设为卡带封面" disabled={!ready || busy || coverBusy} onClick={(event) => { void setCurrentFrameAsCover(); returnFocusAfterClick(event); }}><Icon name="image"/></button>}<span className="toolbar-divider"/><button className="icon-button" aria-label={muted ? '开启声音' : '静音'} title={muted ? '开启声音' : '静音'} disabled={!ready || !audioSupported} onClick={(event) => { updateAudio(volume, !muted); returnFocusAfterClick(event); }}><Icon name={muted || volume === 0 ? 'mute' : 'volume'}/></button><label className="player-volume"><span className="sr-only">播放器音量</span><input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} disabled={!ready || !audioSupported} onChange={(event) => updateAudio(Number(event.target.value), false)}/></label></div><div className="presentation-actions"><div className="display-popover-anchor"><button className={`icon-button${displayMenuOpen ? ' active' : ''}`} aria-label="画面显示设置" title="画面比例与滤镜" aria-expanded={displayMenuOpen} onClick={() => setDisplayMenuOpen((value) => !value)}><Icon name="display"/></button>{displayMenuOpen && <div className="display-popover" role="region" aria-label="画面显示设置"><div className="display-popover-header"><strong>画面显示</strong><button type="button" className="icon-button" aria-label="关闭画面设置" onClick={() => setDisplayMenuOpen(false)}><Icon name="close" size={14}/></button></div><div className="display-ratio-pills">{([['4:3', '4:3 电视'], ['pixel', '8:7 像素'], ['stretch', '铺满']] as const).map(([value, label]) => <button key={value} type="button" className={settings.aspectRatio === value ? 'active' : ''} aria-pressed={settings.aspectRatio === value} onClick={() => updateDisplay({ aspectRatio: value })}>{label}</button>)}</div><label className="display-toggle-row"><span>像素清晰（无模糊）</span><input type="checkbox" checked={settings.pixelated} onChange={(event) => updateDisplay({ pixelated: event.target.checked })}/></label><label className="display-toggle-row"><span>CRT 显像管扫描线</span><input type="checkbox" checked={settings.crt} onChange={(event) => updateDisplay({ crt: event.target.checked })}/></label></div>}</div><button className={`icon-button cheat-toolbar-button${activeCheatCount > 0 ? ' active' : ''}`} aria-label="金手指" title={activeCheatCount > 0 ? `金手指（已启用 ${activeCheatCount} 条）` : '金手指（Game Genie / 内存锁）'} disabled={!ready || busy} onClick={() => { setCheatError(''); setCheatsOpen(true); }}><Icon name="spark"/>{activeCheatCount > 0 && <span className="toolbar-badge">{activeCheatCount}</span>}</button><button className="icon-button" aria-label={touchVisible ? '隐藏屏幕手柄' : '显示屏幕手柄'} title="屏幕手柄" aria-pressed={touchVisible} onClick={(event) => { input.releaseAll(); setTouchVisible(!touchVisible); returnFocusAfterClick(event); }}><Icon name="gamepad"/></button><button className="icon-button" aria-label="查看这张卡带怎么玩" title="怎么玩" onClick={() => setHelpOpen(true)}><Icon name="help"/></button>{onOpenInputSettings && <button className="icon-button" aria-label="按键设置" title="按键设置" disabled={busy} onClick={() => void openInputSettings()}><Icon name="keyboard"/></button>}{!expanded && <button className="icon-button sidebar-toggle-button" aria-label={sidebarCollapsed ? '展开存档侧栏' : '收起存档侧栏'} title={sidebarCollapsed ? '展开存档侧栏' : '收起存档侧栏'} aria-pressed={sidebarCollapsed} onClick={(event) => { setSidebarCollapsed((value) => !value); returnFocusAfterClick(event); }}><Icon name="panel"/></button>}<button className="icon-button" aria-label={expanded ? '退出全屏或大屏' : '全屏游玩'} title={expanded ? '退出大屏' : '全屏游玩'} disabled={!ready} onClick={() => void togglePresentation().catch((cause) => setError(errorMessage(cause)))}><Icon name={expanded ? 'close' : 'expand'}/></button></div></div>
    <div className="player-key-hints" role="region" aria-label="当前游戏键位"><button className="hint-player" aria-label="切换查看玩家键位" onClick={(event) => { setHintPlayer(hintPlayer === 1 ? 2 : 1); returnFocusAfterClick(event); }}>{hintPlayer}P 键盘</button>{device === 'none' ? <><span>方向 <kbd>{['up', 'down', 'left', 'right'].map((button) => keyLabel(settings.keyboardMappings[hintPlayer][button as 'up'])).join(' ')}</kbd></span>{(['a', 'b', 'start', 'select'] as const).map((button) => <span key={button}>{BUTTON_LABELS[button]} <kbd>{keyLabel(settings.keyboardMappings[hintPlayer][button])}</kbd></span>)}{settings.keyboardMappings[hintPlayer].turboA && <span>{BUTTON_LABELS.turboA} <kbd>{keyLabel(settings.keyboardMappings[hintPlayer].turboA)}</kbd></span>}{settings.keyboardMappings[hintPlayer].turboB && <span>{BUTTON_LABELS.turboB} <kbd>{keyLabel(settings.keyboardMappings[hintPlayer].turboB)}</kbd></span>}</> : <span>{device === 'family' ? 'Family' : 'Subor'} 学习键盘 · 点击画面后直接输入</span>}</div>
    {touchVisible && <TouchControls input={input} enabled={inputEnabled} haptics={localPrefs.touchHaptics} size={settings.touchSize} opacity={settings.touchOpacity} position={settings.touchPosition}/>}
    <div className="presentation-learning"><LearningKeyboard input={input} enabled={inputEnabled && device !== 'none'} expanded={keyboardExpanded} onToggle={() => { input.releaseAll(); setKeyboardExpanded((value) => !value); }}/></div>
    <div className="machine-footer">{phase === 'running' ? (canvasFocused ? <span>{device !== 'none' ? '学习键盘已聚焦 · 直接敲击实体键盘输入' : `键盘已就绪 · 开始 ${keyLabel(p1.start)} · 确认/跳 ${keyLabel(p1.a)} (A) · 取消/攻 ${keyLabel(p1.b)} (B)`}</span> : <button type="button" className="footer-focus-button" onClick={focusCanvas}>键盘焦点在页面控件 · 点击画面恢复键盘操控</button>) : <span>先点击运行或按 Enter，再按游戏开始 / A 键进入</span>}<span>{coreName || '等待核心'}{speed > 1 ? ' · 2× 快进' : ''}</span></div></div>
    <aside className={`player-sidebar${detailsOpen ? ' details-open' : ''}`}><button className="player-details-toggle" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}><Icon name="save" size={18}/>存档与输入设备<Icon name="chevron" size={16}/></button><div className="player-details"><section className="player-panel"><h2><Icon name="save" size={18}/>进度存档</h2><label className="field-label">即时存档槽位<select value={slot} disabled={busy || exitOpen} onChange={(event) => setSlot(Number(event.target.value))}>{SAVE_SLOTS.map((value) => <option value={value} key={value}>槽位 {value}{value === 10 ? '（自动）' : ''}{saves.some((save) => save.kind === 'state' && save.slot === value) ? ' · 已有存档' : ' · 空'}</option>)}</select></label>{selectedSave?.thumbUrl && <div className="save-slot-preview"><img className="save-slot-thumb" src={selectedSave.thumbUrl} alt={`槽位 ${slot} 存档画面预览`}/></div>}{savesLoading ? <p className="small-muted">正在读取存档…</p> : <p className="small-muted">{selectedSave ? `上次保存 ${formatDate(selectedSave.createdAt)}` : '此槽位还没有存档'}</p>}<div className="save-actions"><button className="button secondary" disabled={!ready || busy || !!pending || savesLoading || !!savesError} onClick={(event) => { void save('state'); returnFocusAfterClick(event); }}><Icon name="save" size={17}/>{busy ? '请稍候…' : '保存进度'}</button><button className="button secondary" disabled={!ready || busy || !!pending || !selectedSave} onClick={() => void loadSave()}><Icon name="load" size={17}/>读取进度</button></div><label className="panel-checkbox"><input type="checkbox" checked={localPrefs.autoSaveOnExit} onChange={(event) => setAutoSaveOnExit(event.target.checked)}/><span>离开播放器时自动存到槽位 10</span></label><button className="text-button battery-save" disabled={!ready || busy || exitOpen} onClick={() => void downloadSnapshot()}>下载当前即时存档</button><button className="text-button battery-save" disabled={!ready || busy || !!pending || savesLoading || !!savesError} onClick={(event) => { void save('sram'); returnFocusAfterClick(event); }}>保存卡带电池存档</button>{selectedSave && <button className="text-button battery-save danger-text" disabled={!ready || busy || !!pending || exitOpen} onClick={() => setDeleteSaveOpen(true)}>删除此槽位存档</button>}{savesError && <ErrorNotice message={savesError} onRetry={() => void refreshSaves()}/>}<p className="panel-note">即时存档记录画面与缩略图（支持 10 个槽位）。支持电池存档的卡带每 30 秒保存一次变更；冲突时保留本地快照。</p></section>
    <section className="player-panel"><h2><Icon name="keyboard" size={18}/>输入设备</h2><label className="field-label">学习键盘设备<select value={device} disabled={!ready || busy} onChange={(event) => { const value = event.target.value as KeyboardDevice; input.releaseAll(); adapterRef.current?.setKeyboardDevice(value); setDevice(value); if (value !== 'none') setKeyboardExpanded(true); }}><option value="none">游戏手柄模式</option><option value="family">任天堂家庭电脑键盘（Family）</option><option value="subor">小霸王学习键盘（Subor）</option></select></label><div className="keyboard-map"><span>快捷存档</span><kbd>F5</kbd><span>快捷读档</span><kbd>F8</kbd><span>2× 快进</span><kbd>F9</kbd><span>时光回溯</span><kbd>Backspace</kbd><span>暂停 / 继续</span><kbd>Pause</kbd></div><p className="panel-note">游戏键位见画面下方按键条，支持在“按键设置”自定义 1P/2P 及连发键。学习模式会把实体键盘输入直接发送给卡带。</p>{gamepads.length > 0 && <p className="connected-gamepads">{gamepads.map((name, index) => <span key={`${name}-${index}`}>{index + 1}P · {name}</span>)}</p>}</section></div></aside></div>
    {game?.controls && <section className="game-controls-help"><h2>这张卡带怎么玩</h2><p>{game.controls}</p><span>上文按默认键位说明；自定义键位以“使用设置”与上方按键图为准。</span></section>}
    {helpOpen && <Dialog title="这张卡带怎么玩" onClose={() => setHelpOpen(false)}><p className="player-help-copy">先点击运行按钮开启画面与声音，再按卡带的开始或确认键进入游戏。快捷操作：F5 保存当前槽位，F8 快速读取当前槽位，F9 切换 2 倍快进。</p>{game?.controls && <p className="player-help-copy">{game.controls}</p>}<div className="player-help-mappings">{([1, 2] as const).map((player) => <section key={player}><h3>玩家 {player}</h3>{BUTTONS.filter((button) => !!settings.keyboardMappings[player][button]).map((button) => <div key={button}><span>{BUTTON_LABELS[button]}</span><kbd>{keyLabel(settings.keyboardMappings[player][button])}</kbd></div>)}</section>)}</div></Dialog>}
    {renameOpen && game && <Dialog title="重命名卡带" onClose={() => { if (!renameBusy) setRenameOpen(false); }}><form onSubmit={(event) => { event.preventDefault(); void submitRename(); }}><label className="field-label">卡带名称<input autoFocus value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} maxLength={160} required disabled={renameBusy}/></label>{renameError && <ErrorNotice message={renameError}/>}<div className="dialog-footer"><span/><div className="button-row"><button type="button" className="button secondary" disabled={renameBusy} onClick={() => setRenameOpen(false)}>取消</button><button className="button primary" disabled={renameBusy || !renameTitle.trim()}>{renameBusy ? '正在保存…' : '保存名称'}</button></div></div></form></Dialog>}
    {cheatsOpen && <Dialog title="金手指（Game Genie / 内存锁）" description="支持 6 位或 8 位经典 NES Game Genie 代码（如 SXIOPO、SLXPLOVS），也支持系统内存锁定（如 0032:1E）。记录保存在当前浏览器的本卡带空间中。" onClose={() => { if (!busy) setCheatsOpen(false); }} wide>
      <form className="cheat-add-form" onSubmit={(event) => { event.preventDefault(); addCheat(); }}>
        <label className="field-label">金手指代码<input value={cheatCodeInput} onChange={(event) => { setCheatCodeInput(event.target.value); setCheatError(''); }} placeholder="如 SLXPLOVS 或 0032:1E" maxLength={24} disabled={busy}/></label>
        <label className="field-label">备注名称<span>可选</span><input value={cheatLabelInput} onChange={(event) => setCheatLabelInput(event.target.value)} placeholder="如 无限生命 / 30 条命" maxLength={40} disabled={busy}/></label>
        <button type="submit" className="button secondary" disabled={busy || !cheatCodeInput.trim()}><Icon name="plus" size={16}/>添加</button>
      </form>
      {cheatError && <ErrorNotice message={cheatError}/>}
      {cheats.length > 0 ? <ul className="cheat-list">{cheats.map((item) => <li key={item.id}>
        <label className="cheat-toggle"><input type="checkbox" checked={item.enabled} disabled={busy} onChange={() => toggleCheat(item.id)}/><div><strong>{item.label}</strong><code>{item.code}</code></div></label>
        <button type="button" className="icon-button danger-text" aria-label={`删除金手指 ${item.code}`} disabled={busy} onClick={() => removeCheat(item.id)}><Icon name="delete" size={16}/></button>
      </li>)}</ul> : <p className="small-muted">当前卡带还没有金手指。内存锁添加后实时生效；Game Genie 代码点下方「应用」即可生效。</p>}
      <div className="dialog-footer"><span>{cheatsDirty ? 'Game Genie 改动待应用到当前卡带。' : '内存锁即时生效；启动类代码建议选择“应用并重启”。'}</span><div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={() => setCheatsOpen(false)}>关闭</button>{cheatsDirty && <><button type="button" className="button secondary" disabled={busy} onClick={() => void applyGameGenieAndReload(false)}>应用并重启</button><button type="button" className="button primary" disabled={busy} onClick={() => void applyGameGenieAndReload(true)}>应用并继续画面</button></>}</div></div>
    </Dialog>}
    {overrideOpen && pending && <Dialog title="处理存档冲突" description="服务器中已有其他进度。保留两份会下载本地快照并保留服务器原存档；更新服务器会重新读取版本，仍按版本条件写入。" onClose={() => { if (!busy) setOverrideOpen(false); }}><div className="dialog-footer"><span/><div className="button-row"><button className="button secondary" disabled={busy} onClick={() => downloadPending(true)}>保留两份，下载本地</button><button className="button primary" disabled={busy} onClick={() => void overwritePending()}>用本地进度更新服务器</button></div></div></Dialog>}
    {exitOpen && <Dialog title="离开前保留进度" description="尚有本地进度未上传。重试成功后才能安全离开；也可下载本地快照保留服务器原存档，或明确确认丢弃。刷新或关闭页面不保证完成服务器上传。" onClose={() => finishExit(false)}><div className="dialog-footer"><span/><div className="button-row"><button className="button secondary" onClick={() => finishExit(false)}>留在播放器</button><button className="button secondary" disabled={busy} onClick={() => { void flushExit().then((ok) => { if (ok) finishExit(true); }); }}>保存 / 重试后离开</button>{conflict && <button className="button secondary" disabled={busy} onClick={() => setOverrideOpen(true)}>处理服务器冲突</button>}<button className="button secondary" disabled={busy} onClick={downloadExit}>下载快照并离开</button><button className="button primary" disabled={busy} onClick={() => setDiscardOpen(true)}>丢弃并离开…</button></div></div></Dialog>}
    {discardOpen && <Dialog title="确认丢弃本地进度" description="此操作不可撤销。尚未上传的本地快照将删除，服务器已有存档不会改变。" onClose={() => setDiscardOpen(false)}><div className="dialog-footer"><span/><div className="button-row"><button className="button secondary" onClick={() => setDiscardOpen(false)}>取消</button><button className="button primary" disabled={busy} onClick={() => { session.discard(); syncPending(); finishExit(true); }}>确认丢弃并离开</button></div></div></Dialog>}
    {resetOpen && <Dialog title="重新启动卡带" description="尚未保存的进度会丢失，已保存的服务器存档会保留。" onClose={() => { if (!busy) setResetOpen(false); }}><div className="dialog-footer"><span/><div className="button-row"><button className="button secondary" disabled={busy} onClick={() => setResetOpen(false)}>取消</button><button className="button primary" disabled={busy} onClick={() => void reset()}>{busy ? '正在重置…' : '重新启动'}</button></div></div></Dialog>}
    {deleteSaveOpen && selectedSave && <Dialog title="删除即时存档" description={`确定要删除槽位 ${slot} 的即时存档吗？此操作不可撤销。`} onClose={() => { if (!busy) setDeleteSaveOpen(false); }}><div className="dialog-footer"><span/><div className="button-row"><button className="button secondary" disabled={busy} onClick={() => setDeleteSaveOpen(false)}>取消</button><button className="button danger" disabled={busy} onClick={() => void deleteSelectedSave()}>{busy ? '正在删除…' : '确认删除'}</button></div></div></Dialog>}
  </div>;
}
