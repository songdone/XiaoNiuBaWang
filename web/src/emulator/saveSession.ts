import type { SaveUpload } from '../api/client';
import type { SaveRecord } from '../types';
import { sameBytes } from './saves';

export const EXIT_WAIT_MS = 5_000;
const storageKey = (gameId: string) => `xnbw:pending:${gameId}`;

/** One owner for all adapter/save operations; React state is not a mutex. */
export class SaveSession {
  busy = false;
  pending: SaveUpload[] = [];
  lastRAM: Uint8Array | null = null;
  private operation: Promise<unknown> | null = null;
  storageError = '';

  constructor(readonly gameId: string) {
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey(gameId)) || '[]');
      if (!Array.isArray(stored)) throw new Error('Invalid pending snapshots');
      this.pending = stored.map((item) => {
        if (!item || item.game?.id !== gameId || !['state', 'sram'].includes(item.kind) ||
          !Array.isArray(item.bytes) || !item.bytes.length || !item.bytes.every((byte: unknown) => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255) ||
          ![0, 1, 2, 3].includes(item.slot) || (item.kind === 'sram' ? item.slot !== 0 : item.slot === 0) ||
          typeof item.core !== 'string' || typeof item.coreVersion !== 'string') throw new Error('Invalid pending snapshot');
        return { ...item, bytes: new Uint8Array(item.bytes) } as SaveUpload;
      });
    } catch { this.storageError = '无法读取本标签页保留的快照，请勿刷新；可下载当前进度。'; }
  }
  persist() {
    try {
      if (this.pending.length) sessionStorage.setItem(storageKey(this.gameId), JSON.stringify(this.pending.map((snapshot) => ({ ...snapshot, bytes: Array.from(snapshot.bytes) }))));
      else sessionStorage.removeItem(storageKey(this.gameId));
      this.storageError = '';
    } catch { this.storageError = '浏览器未能持久保留本地快照。刷新或关闭前请下载，当前内存中的快照仍在。'; }
  }
  retain(snapshot: SaveUpload) {
    if (!this.pending.includes(snapshot)) this.pending.push({ ...snapshot, bytes: snapshot.bytes.slice() });
    this.persist();
    return this.pending[this.pending.length - 1];
  }
  remove(snapshot: SaveUpload, saved?: SaveRecord) {
    this.pending = this.pending.filter((item) => item !== snapshot);
    // Follow a version produced by our own successful upload, not an unseen remote version.
    if (saved) for (const item of this.pending) {
      if (item.kind === saved.kind && item.slot === saved.slot && item.existing?.etag === snapshot.existing?.etag) item.existing = saved;
    }
    this.persist();
  }
  discard() { this.pending = []; this.persist(); }
  ramChanged(bytes: Uint8Array) { return bytes.length > 0 && !sameBytes(this.lastRAM, bytes); }
  hasLatestRAM(bytes: Uint8Array) {
    const latest = this.pending.filter((item) => item.kind === 'sram').at(-1);
    return !!latest && sameBytes(latest.bytes, bytes);
  }
  async run<T>(task: () => Promise<T> | T): Promise<T | undefined> {
    if (this.busy) return undefined;
    this.busy = true;
    const operation = Promise.resolve().then(task);
    this.operation = operation;
    try { return await operation; }
    finally { this.operation = null; this.busy = false; }
  }
  async waitIdle(milliseconds = EXIT_WAIT_MS): Promise<boolean> {
    if (!this.operation) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.operation.then(() => true, () => true),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), milliseconds); }),
      ]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
}

/** Timeout stops navigation waiting, never unlocks an upload that still owns the mutex. */
export async function bounded<T>(operation: Promise<T>, milliseconds = EXIT_WAIT_MS): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), milliseconds); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
