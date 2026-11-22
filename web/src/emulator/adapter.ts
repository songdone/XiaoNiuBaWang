import { apiHeaders, appUrl } from '../api/urls';
import type { CoreDescriptor } from '../types';

export type ControllerButton = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'select' | 'start';
export type PlayerNumber = 1 | 2;
export type KeyboardDevice = 'none' | 'family' | 'subor';
export interface LearningKeyEvent {
  code: string;
  key: string;
  pressed: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  capsLock: boolean;
}

/** Stable UI boundary around the locally compiled core; never an assumed browser global. */
export interface EmulatorAdapter {
  readonly name: string;
  readonly version: string;
  readonly capabilities: { keyboard: boolean; saveState: boolean; saveRAM: boolean; audio: boolean };
  load(rom: Uint8Array): Promise<void>;
  start(): Promise<void> | void;
  pause(): Promise<void> | void;
  reset(): Promise<void> | void;
  setButton(player: PlayerNumber, button: ControllerButton, pressed: boolean): void;
  setKeyboardKey(event: LearningKeyEvent): void;
  setKeyboardDevice(device: KeyboardDevice): void;
  releaseAll(): void;
  setVolume(volume: number): void;
  saveState(): Uint8Array;
  loadState(state: Uint8Array): void;
  getSaveRAM(): Uint8Array;
  loadSaveRAM(state: Uint8Array): void;
  destroy(): Promise<void> | void;
}

export interface EmulatorContext {
  canvas: HTMLCanvasElement;
  signal: AbortSignal;
  onError: (error: Error) => void;
}
export interface CoreAudioFrame { samples: Float32Array | Int16Array; sampleRate: number; channels: 2 }
export interface CoreRuntime {
  readonly version: string;
  loadRom(rom: Uint8Array): void;
  start(): void;
  pause(): void;
  reset(): void;
  runFrame(): void;
  setButton(player: number, index: number, down: boolean): void;
  setKey(retroKey: number, down: boolean): void;
  releaseAll(): void;
  setKeyboardDevice(device: KeyboardDevice): void;
  getState(): Uint8Array;
  loadState(state: Uint8Array): boolean;
  getSaveRAM(): Uint8Array;
  loadSaveRAM(state: Uint8Array): boolean;
  destroy(): void;
  setVolume?(volume: number): void;
  resumeAudio?(): Promise<void>;
}
export interface FceummModule {
  create(options: {
    canvas: HTMLCanvasElement;
    onFrame?: (frame: { data: Uint8Array; width: number; height: number }) => void;
    onAudio?: (frame: CoreAudioFrame) => void;
  }): Promise<CoreRuntime>;
  browserCodeToRetroKey(code: string): number | null | undefined;
}
export type AdapterResult = { status: 'ready'; adapter: EmulatorAdapter } | { status: 'unavailable'; reason: string };
const BUTTON_IDS: Record<ControllerButton, number> = { b: 0, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7, a: 8 };

function validRuntime(value: unknown): value is CoreRuntime {
  if (!value || typeof value !== 'object') return false;
  return ['loadRom', 'start', 'pause', 'reset', 'runFrame', 'setButton', 'setKey', 'releaseAll',
    'setKeyboardDevice', 'getState', 'loadState', 'getSaveRAM', 'loadSaveRAM', 'destroy'].every(
    (method) => typeof (value as Record<string, unknown>)[method] === 'function',
  );
}

export function coreVersionIdentifier(raw: string): string {
  const version = raw.trim();
  const bundled = /^FCEUmm ([a-f0-9]{40}) \+ XiaoNiuBaWang keyboard bridge ([0-9]+)$/i.exec(version);
  if (bundled) return `fceumm-${bundled[1].toLowerCase()}+xnbw-keyboard.${bundled[2]}`;
  if (/^[A-Za-z0-9._+-]{1,96}$/.test(version)) return version;
  throw new Error('当前核心未提供兼容的版本标识，请检查核心安装包。');
}

export async function createAdapter(context: EmulatorContext, descriptor: CoreDescriptor | null): Promise<AdapterResult> {
  if (descriptor?.available === false) return {
    status: 'unavailable', reason: descriptor.reason && /[\u4e00-\u9fff]/.test(descriptor.reason) ? descriptor.reason : '此安装包尚未包含可运行的 NES 模拟器核心。',
  };
  const moduleUrl = new URL(appUrl('cores/fceumm.js'), window.location.origin).href;
  let runtime: CoreRuntime | null = null;
  try {
    const response = await fetch(moduleUrl, { signal: context.signal, credentials: 'same-origin', headers: apiHeaders() });
    if (!response.ok || !/javascript|ecmascript/.test(response.headers.get('content-type') || '')) {
      return { status: 'unavailable', reason: '此安装包没有已构建的 NES 核心，暂时无法运行卡带。' };
    }
    const module = await import(/* @vite-ignore */ moduleUrl) as Partial<FceummModule>;
    if (typeof module.create !== 'function' || typeof module.browserCodeToRetroKey !== 'function') {
      return { status: 'unavailable', reason: '核心未提供兼容的模块接口，请检查安装包中的核心版本。' };
    }
    const instance: unknown = await module.create({ canvas: context.canvas });
    if (!validRuntime(instance)) {
      if (instance && typeof (instance as Partial<CoreRuntime>).destroy === 'function') (instance as CoreRuntime).destroy();
      return { status: 'unavailable', reason: '核心接口不完整，无法安全启动游戏。' };
    }
    runtime = instance;
    if (context.signal.aborted) { runtime.destroy(); throw new DOMException('Aborted', 'AbortError'); }
    const core = runtime;
    const adapter: EmulatorAdapter = {
      name: 'FCEUmm', version: coreVersionIdentifier(core.version),
      capabilities: { keyboard: true, saveState: true, saveRAM: true, audio: typeof core.setVolume === 'function' },
      async load(rom) { core.loadRom(rom); },
      async start() { await core.resumeAudio?.(); core.start(); },
      pause() { core.pause(); core.releaseAll(); },
      reset() { core.releaseAll(); core.reset(); },
      setButton(player, button, pressed) { core.setButton(player - 1, BUTTON_IDS[button], pressed); },
      setKeyboardKey(event) {
        const key = module.browserCodeToRetroKey!(event.code);
        if (typeof key === 'number' && key > 0) core.setKey(key, event.pressed);
      },
      setKeyboardDevice(device) { core.releaseAll(); core.setKeyboardDevice(device); },
      releaseAll() { core.releaseAll(); },
      setVolume(volume) { core.setVolume?.(Math.max(0, Math.min(1, volume))); },
      saveState() {
        const bytes = core.getState();
        if (!bytes.length) throw new Error('核心没有返回有效的即时存档。');
        return bytes.slice();
      },
      loadState(bytes) { core.releaseAll(); if (!core.loadState(bytes)) throw new Error('核心拒绝了此存档，版本或卡带可能不兼容。'); },
      getSaveRAM() { return core.getSaveRAM().slice(); },
      loadSaveRAM(bytes) { if (!core.loadSaveRAM(bytes)) throw new Error('此 SRAM 与当前卡带不兼容。'); },
      destroy() { core.releaseAll(); core.destroy(); },
    };
    return { status: 'ready', adapter };
  } catch (error) {
    runtime?.destroy();
    if (context.signal.aborted) throw error;
    return { status: 'unavailable', reason: '模拟器核心加载失败，请重新打开；若仍无法加载，请检查安装包是否包含完整核心文件。' };
  }
}
