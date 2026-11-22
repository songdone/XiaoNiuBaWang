export interface Frame { data: Uint8ClampedArray; width: number; height: number; frameNumber: number }
export interface AudioFrame { samples: Float32Array; sampleRate: number; channels: 2 }
export interface CreateOptions {
  canvas?: HTMLCanvasElement | null;
  onFrame?: ((frame: Frame) => void) | null;
  onAudio?: ((audio: AudioFrame) => void) | null;
  /** WebAudio playback, default true. onAudio still receives samples when false. */
  audio?: boolean;
  /** Initial output gain, clamped to 0..1. Default 0.7. */
  volume?: number;
  /** Optional preloaded WASM bytes, useful in non-browser hosts. */
  wasmBinary?: Uint8Array | ArrayBuffer | null;
}
export interface Runtime {
  readonly version: string;
  readonly isRunning: boolean;
  readonly isLoaded: boolean;
  readonly fps: number;
  readonly sampleRate: number;
  loadRom(bytes: Uint8Array | ArrayBuffer): { fps: number; sampleRate: number; version: string };
  runFrame(): Frame;
  start(): void;
  pause(): void;
  reset(): void;
  /** Zero-based player 0..3; libretro joypad IDs (see JOYPAD). */
  setButton(player: number, index: number, down: boolean): void;
  /** Numeric libretro RETROK key. Use browserCodeToRetroKey for DOM events. */
  setKey(retroKey: number, down: boolean): void;
  releaseAll(): void;
  setKeyboardDevice(device: 'none' | 'family' | 'subor' | 0 | 1283 | 1539): void;
  getState(): Uint8Array;
  loadState(bytes: Uint8Array | ArrayBuffer): boolean;
  /** Copied guest 2 KiB work RAM for diagnostics. */
  getSystemRAM(): Uint8Array;
  getSaveRAM(): Uint8Array;
  loadSaveRAM(bytes: Uint8Array | ArrayBuffer): boolean;
  setVolume(volume: number): void;
  /** Call from a click/key gesture to satisfy browser audio autoplay policy. */
  resumeAudio(): Promise<boolean>;
  getDiagnostics(): { loaded: boolean; running: boolean; keyboardDevice: number; keyboardPolls: number; frameNumber: number; width: number; height: number; fps: number; sampleRate: number; audioState: string; volume: number };
  destroy(): Promise<void>;
}
export const JOYPAD: Readonly<Record<'B' | 'Y' | 'SELECT' | 'START' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'A' | 'X' | 'L' | 'R', number>>;
export const KEYBOARD_DEVICES: Readonly<{ none: 0; family: 1283; subor: 1539 }>;
export const RETRO_KEYS: Readonly<Record<string, number>>;
export function browserCodeToRetroKey(codeOrEvent: string | Pick<KeyboardEvent, 'code'>): number | null;
export function create(options?: CreateOptions): Promise<Runtime>;
export default create;
