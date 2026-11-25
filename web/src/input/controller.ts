import type { ControllerButton, EmulatorAdapter, LearningKeyEvent, PlayerNumber } from '../emulator/adapter';

export interface InputSnapshot {
  buttons: ReadonlySet<string>;
  keys: ReadonlySet<string>;
  turbo: ReadonlySet<string>;
}

const TURBO_INTERVAL_MS = 33;

/** Inputs are held per source so a touch release cannot cancel a held physical key. */
export class InputController {
  private adapter: EmulatorAdapter | null = null;
  private buttons = new Map<string, Set<string>>();
  private turbo = new Map<string, Set<string>>();
  private turboPhase = true;
  private turboTimer: ReturnType<typeof setInterval> | null = null;
  private keys = new Map<string, Map<string, LearningKeyEvent>>();
  private listeners = new Set<() => void>();
  private releaseListeners = new Set<(sources: ReadonlySet<string>) => void>();
  private snapshot: InputSnapshot = { buttons: new Set(), keys: new Set(), turbo: new Set() };

  /** Reports only sources that were actually held and have now been released. */
  subscribeRelease = (listener: (sources: ReadonlySet<string>) => void) => {
    this.releaseListeners.add(listener);
    return () => { this.releaseListeners.delete(listener); };
  };

  hasSource(source: string) {
    for (const sources of this.buttons.values()) if (sources.has(source)) return true;
    for (const sources of this.turbo.values()) if (sources.has(source)) return true;
    for (const sources of this.keys.values()) if (sources.has(source)) return true;
    return false;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.snapshot;

  attach(adapter: EmulatorAdapter | null) {
    this.releaseAll();
    this.adapter = adapter;
  }

  setButton(source: string, player: PlayerNumber, button: ControllerButton, pressed: boolean) {
    const key = `${player}:${button}`;
    const sources = this.buttons.get(key) ?? new Set<string>();
    const wasPressed = sources.size > 0;
    if (pressed) sources.add(source);
    else sources.delete(source);
    if (sources.size) this.buttons.set(key, sources);
    else this.buttons.delete(key);
    if (wasPressed !== (sources.size > 0)) {
      this.adapter?.setButton(player, button, sources.size > 0);
      this.publish();
    }
  }

  setTurbo(source: string, player: PlayerNumber, button: 'a' | 'b', pressed: boolean) {
    const key = `${player}:${button}`;
    const sources = this.turbo.get(key) ?? new Set<string>();
    const wasActive = sources.size > 0;
    if (pressed) sources.add(source);
    else sources.delete(source);
    if (sources.size) this.turbo.set(key, sources);
    else this.turbo.delete(key);
    const active = sources.size > 0;
    if (wasActive !== active) {
      const synthetic = `turbo-pulse:${key}`;
      if (active) {
        this.turboPhase = true;
        this.setButton(synthetic, player, button, true);
        this.ensureTurboTimer();
      } else {
        this.setButton(synthetic, player, button, false);
        if (!this.turbo.size) this.stopTurboTimer();
      }
      this.publish();
    }
  }

  private ensureTurboTimer() {
    if (this.turboTimer !== null) return;
    this.turboTimer = setInterval(() => {
      if (!this.turbo.size) { this.stopTurboTimer(); return; }
      this.turboPhase = !this.turboPhase;
      for (const key of this.turbo.keys()) {
        const [player, button] = key.split(':');
        this.setButton(`turbo-pulse:${key}`, Number(player) as PlayerNumber, button as ControllerButton, this.turboPhase);
      }
    }, TURBO_INTERVAL_MS);
  }

  private stopTurboTimer() {
    if (this.turboTimer !== null) {
      clearInterval(this.turboTimer);
      this.turboTimer = null;
    }
    this.turboPhase = true;
  }

  setKey(source: string, event: LearningKeyEvent) {
    const sources = this.keys.get(event.code) ?? new Map<string, LearningKeyEvent>();
    const wasPressed = sources.size > 0;
    if (event.pressed) sources.set(source, event);
    else sources.delete(source);
    if (sources.size) this.keys.set(event.code, sources);
    else this.keys.delete(event.code);
    if (wasPressed !== (sources.size > 0)) {
      this.adapter?.setKeyboardKey?.({ ...event, pressed: sources.size > 0 });
      this.publish();
    }
  }

  releaseSource(source: string) {
    if (!this.hasSource(source)) return;
    for (const [key, sources] of [...this.turbo]) {
      if (!sources.has(source)) continue;
      const [player, button] = key.split(':');
      this.setTurbo(source, Number(player) as PlayerNumber, button as 'a' | 'b', false);
    }
    for (const [key, sources] of [...this.buttons]) {
      if (!sources.has(source)) continue;
      const [player, button] = key.split(':');
      this.setButton(source, Number(player) as PlayerNumber, button as ControllerButton, false);
    }
    for (const sources of [...this.keys.values()]) {
      const event = sources.get(source);
      if (event) this.setKey(source, { ...event, pressed: false });
    }
    this.notifyRelease(new Set([source]));
  }

  releasePrefix(prefix: string) {
    const sources = new Set<string>();
    for (const held of this.turbo.values()) for (const source of held) if (source.startsWith(prefix)) sources.add(source);
    for (const held of this.buttons.values()) for (const source of held) if (source.startsWith(prefix)) sources.add(source);
    for (const held of this.keys.values()) for (const source of held.keys()) if (source.startsWith(prefix)) sources.add(source);
    for (const source of sources) this.releaseSource(source);
  }

  releaseAll() {
    this.stopTurboTimer();
    if (!this.buttons.size && !this.keys.size && !this.turbo.size) return;
    const released = new Set<string>();
    for (const sources of this.turbo.values()) for (const source of sources) released.add(source);
    for (const sources of this.buttons.values()) for (const source of sources) released.add(source);
    for (const sources of this.keys.values()) for (const source of sources.keys()) released.add(source);
    for (const key of this.buttons.keys()) {
      const [player, button] = key.split(':');
      this.adapter?.setButton(Number(player) as PlayerNumber, button as ControllerButton, false);
    }
    for (const sources of this.keys.values()) {
      const event = sources.values().next().value;
      if (event) this.adapter?.setKeyboardKey?.({ ...event, pressed: false });
    }
    this.turbo.clear();
    this.buttons.clear();
    this.keys.clear();
    this.publish();
    this.notifyRelease(released);
  }

  private notifyRelease(sources: ReadonlySet<string>) {
    for (const listener of this.releaseListeners) listener(sources);
  }

  private publish() {
    this.snapshot = { buttons: new Set(this.buttons.keys()), keys: new Set(this.keys.keys()), turbo: new Set(this.turbo.keys()) };
    for (const listener of this.listeners) listener();
  }
}
