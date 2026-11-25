/**
 * Bounded ring-buffer rewind manager for instant NES gameplay time-travel.
 * Stores copied emulator state snapshots (~46 KiB each for FCEUmm; 12 frames ≈ 550 KiB).
 */
export class RewindBuffer {
  private readonly capacity: number;
  private frames: Uint8Array[] = [];

  constructor(capacity = 12) {
    this.capacity = Math.max(2, capacity);
  }

  get size(): number {
    return this.frames.length;
  }

  push(state: Uint8Array): void {
    if (!state.length) return;
    if (this.frames.length >= this.capacity) this.frames.shift();
    this.frames.push(state.slice());
  }

  /** Pop the latest recoverable state snapshot, or null when empty. */
  pop(): Uint8Array | null {
    return this.frames.pop() ?? null;
  }

  clear(): void {
    this.frames = [];
  }
}
