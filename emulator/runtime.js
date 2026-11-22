/* XiaoNiuBaWang standalone FCEUmm runtime. SPDX-License-Identifier: GPL-2.0-or-later */
export const JOYPAD = Object.freeze({ B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, X: 9, L: 10, R: 11 });
export const KEYBOARD_DEVICES = Object.freeze({ none: 0, family: 1283, subor: 1539 });
export const RETRO_KEYS = Object.freeze({ BACKSPACE: 8, TAB: 9, RETURN: 13, PAUSE: 19, ESCAPE: 27, SPACE: 32, BACKQUOTE: 96, DELETE: 127, KP0: 256, KP1: 257, KP2: 258, KP3: 259, KP4: 260, KP5: 261, KP6: 262, KP7: 263, KP8: 264, KP9: 265, KP_PERIOD: 266, KP_DIVIDE: 267, KP_MULTIPLY: 268, KP_MINUS: 269, KP_PLUS: 270, KP_ENTER: 271, KP_EQUALS: 272, UP: 273, DOWN: 274, RIGHT: 275, LEFT: 276, INSERT: 277, HOME: 278, END: 279, PAGEUP: 280, PAGEDOWN: 281, F1: 282, F2: 283, F3: 284, F4: 285, F5: 286, F6: 287, F7: 288, F8: 289, F9: 290, F10: 291, F11: 292, F12: 293, NUMLOCK: 300, CAPSLOCK: 301, SCROLLLOCK: 302, RSHIFT: 303, LSHIFT: 304, RCTRL: 305, LCTRL: 306, RALT: 307, LALT: 308, BREAK: 318 });
const CODE_KEYS = Object.freeze({ Backspace: 8, Tab: 9, Enter: 13, Pause: 19, Escape: 27, Space: 32, Quote: 39, Comma: 44, Minus: 45, Period: 46, Slash: 47, Semicolon: 59, Equal: 61, BracketLeft: 91, Backslash: 92, IntlBackslash: 92, BracketRight: 93, Backquote: 96, Delete: 127, NumpadDecimal: 266, NumpadDivide: 267, NumpadMultiply: 268, NumpadSubtract: 269, NumpadAdd: 270, NumpadEnter: 271, NumpadEqual: 272, ArrowUp: 273, ArrowDown: 274, ArrowRight: 275, ArrowLeft: 276, Insert: 277, Home: 278, End: 279, PageUp: 280, PageDown: 281, NumLock: 300, CapsLock: 301, ScrollLock: 302, ShiftRight: 303, ShiftLeft: 304, ControlRight: 305, ControlLeft: 306, AltRight: 307, AltLeft: 308, MetaRight: 309, MetaLeft: 310, ContextMenu: 319 });

/** Map KeyboardEvent.code (physical key), or an event, to a libretro RETROK value. Unknown keys return null. */
export function browserCodeToRetroKey(codeOrEvent) {
  const code = typeof codeOrEvent === 'string' ? codeOrEvent : codeOrEvent?.code;
  if (typeof code !== 'string') return null;
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3) + 32;
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
  if (/^Numpad[0-9]$/.test(code)) return 256 + Number(code[6]);
  if (/^F([1-9]|1[0-5])$/.test(code)) return 281 + Number(code.slice(1));
  return CODE_KEYS[code] ?? null;
}

/**
 * Create an independent local WASM emulator instance.
 * Factory is async; all methods except resumeAudio/destroy are synchronous.
 * ROMs, snapshots, and SRAM remain in memory; the caller owns persistence.
 * WASM URLs resolve beside this module, including reverse-proxy subpaths.
 */
export async function create({ canvas = null, onFrame = null, onAudio = null, audio = true, volume = 0.7, wasmBinary = null } = {}) {
  const moduleURL = new URL('./fceumm-core.mjs', import.meta.url);
  const wasmURL = new URL('./fceumm-core.wasm', import.meta.url);
  const { default: createModule } = await import(moduleURL.href);
  const moduleOptions = { locateFile: (name) => new URL(name, moduleURL).href };
  if (wasmBinary) moduleOptions.wasmBinary = wasmBinary;
  else if (wasmURL.protocol === 'file:' && typeof process !== 'undefined' && process.versions?.node) {
    const { readFile } = await import('node:fs/promises');
    moduleOptions.wasmBinary = new Uint8Array(await readFile(wasmURL));
  }
  const core = await createModule(moduleOptions);
  if (!core._xn_init()) throw new Error('FCEUmm initialization failed');
  const context = canvas?.getContext('2d', { alpha: false });
  if (canvas && !context) { core._xn_destroy(); throw new Error('A 2D canvas context is required'); }
  let disposed = false, loaded = false, running = false, rafID = null;
  let audioContext = null, gain = null, nextAudioTime = 0, nextFrameTime = 0;
  let currentVolume = Math.min(1, Math.max(0, Number(volume) || 0));
  const sources = new Set();
  const now = () => globalThis.performance?.now() ?? Date.now();
  const requestFrame = globalThis.requestAnimationFrame?.bind(globalThis) ?? ((fn) => setTimeout(() => fn(now()), 16));
  const cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) ?? clearTimeout;
  const assertLive = () => { if (disposed) throw new Error('Emulator has been destroyed'); };
  const assertLoaded = () => { assertLive(); if (!loaded) throw new Error('Load a ROM first'); };
  const bytesOf = (value) => {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    throw new TypeError('Expected Uint8Array or ArrayBuffer');
  };
  const withBytes = (value, fn) => {
    const bytes = bytesOf(value);
    const pointer = core._malloc(bytes.byteLength || 1);
    if (!pointer) throw new Error('WASM allocation failed');
    try { core.HEAPU8.set(bytes, pointer); return fn(pointer, bytes.byteLength); }
    finally { core._free(pointer); }
  };
  const clearAudio = () => {
    for (const source of sources) { try { source.stop(); } catch {} source.disconnect(); }
    sources.clear();
    nextAudioTime = 0;
  };
  const scheduleAudio = (samples, sampleRate) => {
    if (!audio || !audioContext || audioContext.state !== 'running' || !samples.length) return;
    const frames = samples.length / 2;
    if (nextAudioTime - audioContext.currentTime > 0.2) return;
    const buffer = audioContext.createBuffer(2, frames, sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const target = buffer.getChannelData(channel);
      for (let i = 0; i < frames; i++) target[i] = samples[i * 2 + channel];
    }
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.onended = () => { sources.delete(source); source.disconnect(); };
    nextAudioTime = Math.max(audioContext.currentTime + 0.025, nextAudioTime);
    sources.add(source);
    source.start(nextAudioTime);
    nextAudioTime += frames / sampleRate;
  };
  const releaseAll = () => { if (!disposed) core._xn_release_all(); };
  const visibility = () => { if (globalThis.document?.hidden) runtime.pause(); };
  globalThis.addEventListener?.('blur', releaseAll);
  globalThis.document?.addEventListener('visibilitychange', visibility);

  const runtime = {
    version: core.UTF8ToString(core._xn_version()),
    get isRunning() { return running; },
    get isLoaded() { return loaded; },
    get fps() { return loaded ? core._xn_fps() : 60.0988; },
    get sampleRate() { return loaded ? core._xn_sample_rate() : 48000; },
    loadRom(value) {
      assertLive();
      const bytes = bytesOf(value);
      if (bytes.length < 16 || bytes.length > 64 * 1024 * 1024) throw new RangeError('ROM size must be 16 bytes to 64 MiB');
      runtime.pause();
      loaded = false;
      if (!withBytes(bytes, (p, length) => core._xn_load(p, length))) {
        throw new Error(`FCEUmm could not load ROM: ${core.UTF8ToString(core._xn_error()) || 'invalid or unsupported image'}`);
      }
      loaded = true;
      return { fps: runtime.fps, sampleRate: runtime.sampleRate, version: runtime.version };
    },
    runFrame() {
      assertLoaded();
      if (!core._xn_run()) throw new Error('FCEUmm frame failed');
      const width = core._xn_width(), height = core._xn_height();
      const pointer = core._xn_pixels();
      const data = new Uint8ClampedArray(core.HEAPU8.subarray(pointer, pointer + width * height * 4));
      const frame = { data, width, height, frameNumber: core._xn_frame_number() };
      if (context && width && height) {
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        context.imageSmoothingEnabled = false;
        context.putImageData(new ImageData(data, width, height), 0, 0);
      }
      onFrame?.(frame);
      const count = core._xn_audio_frames() * 2;
      if (count) {
        const start = core._xn_audio() >> 1;
        const samples = new Float32Array(count);
        for (let i = 0; i < count; i++) samples[i] = core.HEAP16[start + i] / 32768;
        const sampleRate = runtime.sampleRate;
        onAudio?.({ samples, sampleRate, channels: 2 });
        scheduleAudio(samples, sampleRate);
      }
      return frame;
    },
    start() {
      assertLoaded();
      if (running) return;
      running = true;
      nextFrameTime = now();
      runtime.resumeAudio().catch(() => {});
      const tick = (time) => {
        if (!running || disposed) return;
        let frames = 0;
        if (time - nextFrameTime > 100) nextFrameTime = time;
        while (time >= nextFrameTime && frames < 5 && running) {
          runtime.runFrame();
          nextFrameTime += 1000 / runtime.fps;
          frames++;
        }
        if (running) rafID = requestFrame(tick);
      };
      rafID = requestFrame(tick);
    },
    pause() {
      if (disposed) return;
      running = false;
      if (rafID !== null) cancelFrame(rafID);
      rafID = null;
      releaseAll();
      clearAudio();
    },
    reset() { assertLoaded(); releaseAll(); clearAudio(); core._xn_reset(); },
    setButton(player, index, down) {
      assertLive();
      if (!Number.isInteger(player) || player < 0 || player > 3 || !Number.isInteger(index) || index < 0 || index > 15) throw new RangeError('Player must be 0..3 and button 0..15');
      core._xn_set_button(player, index, down ? 1 : 0);
    },
    setKey(retroKey, down) {
      assertLive();
      if (!Number.isInteger(retroKey) || retroKey < 0 || retroKey >= 342) throw new RangeError('Invalid libretro RETROK key');
      core._xn_set_key(retroKey, down ? 1 : 0);
    },
    releaseAll,
    setKeyboardDevice(device) {
      assertLive();
      const id = typeof device === 'string' ? KEYBOARD_DEVICES[device] : device;
      if (!Object.values(KEYBOARD_DEVICES).includes(id)) throw new RangeError('Keyboard must be none, family or subor');
      core._xn_set_keyboard(id);
    },
    getState() {
      assertLoaded();
      const size = core._xn_state_size();
      if (!size) throw new Error('Core did not provide a snapshot size');
      const pointer = core._malloc(size);
      if (!pointer) throw new Error('WASM allocation failed');
      try {
        if (!core._xn_state_save(pointer, size)) throw new Error('Snapshot failed');
        return core.HEAPU8.slice(pointer, pointer + size);
      } finally { core._free(pointer); }
    },
    loadState(value) {
      assertLoaded();
      const bytes = bytesOf(value);
      if (!bytes.length || bytes.length > 16 * 1024 * 1024) return false;
      clearAudio();
      return Boolean(withBytes(bytes, (pointer, size) => core._xn_state_load(pointer, size)));
    },
    /** Copied 2 KiB guest work RAM, for diagnostics and debugging. */
    getSystemRAM() {
      assertLoaded();
      const pointer = core._xn_memory_data(2), size = core._xn_memory_size(2);
      return pointer && size ? core.HEAPU8.slice(pointer, pointer + size) : new Uint8Array();
    },
    getSaveRAM() {
      assertLoaded();
      const pointer = core._xn_memory_data(0), size = core._xn_memory_size(0);
      return pointer && size ? core.HEAPU8.slice(pointer, pointer + size) : new Uint8Array();
    },
    loadSaveRAM(value) {
      assertLoaded();
      const bytes = bytesOf(value);
      const pointer = core._xn_memory_data(0), size = core._xn_memory_size(0);
      if (!pointer || !size || bytes.length !== size) return false;
      core.HEAPU8.set(bytes, pointer);
      return true;
    },
    setVolume(value) {
      assertLive();
      if (!Number.isFinite(value)) throw new TypeError('Volume must be a finite number');
      currentVolume = Math.min(1, Math.max(0, value));
      if (gain) gain.gain.setValueAtTime(currentVolume, audioContext.currentTime);
    },
    async resumeAudio() {
      assertLive();
      if (!audio) return false;
      if (!audioContext) {
        const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!AudioContextClass) return false;
        audioContext = new AudioContextClass({ latencyHint: 'interactive' });
        gain = audioContext.createGain();
        gain.gain.value = currentVolume;
        gain.connect(audioContext.destination);
      }
      if (audioContext.state === 'suspended') await audioContext.resume();
      return audioContext.state === 'running';
    },
    getDiagnostics() {
      assertLive();
      return { loaded, running, keyboardDevice: core._xn_keyboard_device(), keyboardPolls: core._xn_keyboard_polls(), frameNumber: core._xn_frame_number(), width: core._xn_width(), height: core._xn_height(), fps: runtime.fps, sampleRate: runtime.sampleRate, audioState: audioContext?.state ?? 'uninitialized', volume: currentVolume };
    },
    async destroy() {
      if (disposed) return;
      runtime.pause();
      globalThis.removeEventListener?.('blur', releaseAll);
      globalThis.document?.removeEventListener('visibilitychange', visibility);
      core._xn_destroy();
      loaded = false;
      disposed = true;
      if (audioContext && audioContext.state !== 'closed') await audioContext.close();
    }
  };
  return runtime;
}

export default create;
