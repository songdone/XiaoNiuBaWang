import type { Game, SaveRecord } from '../types';
import type { SaveUpload } from '../api/client';
import type { EmulatorAdapter } from './adapter';

export function assertSaveCompatible(save: SaveRecord, game: Game, adapter: Pick<EmulatorAdapter, 'name' | 'version'>) {
  if (!save.romSha256 || !game.sha256 || save.romSha256 !== game.sha256) throw new Error('存档所属卡带的校验值不一致，无法读取。');
  if (!save.core || save.core.toLowerCase() !== adapter.name.toLowerCase()) throw new Error('存档所属模拟器核心不一致，无法读取。');
  if (!save.coreVersion || save.coreVersion !== adapter.version) throw new Error('存档的核心版本与当前版本不同，请使用兼容版本读取。');
}
export function sameBytes(a: Uint8Array | null, b: Uint8Array) {
  return !!a && a.length === b.length && a.every((byte, index) => byte === b[index]);
}
export function snapshotFilename(snapshot: Pick<SaveUpload, 'game' | 'kind' | 'slot'>) {
  return `${snapshot.game.title}-${snapshot.kind}-${snapshot.slot}.${snapshot.kind === 'sram' ? 'sav' : 'state'}`;
}
