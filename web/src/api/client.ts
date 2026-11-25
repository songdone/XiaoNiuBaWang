import { normalizeMappings } from '../input/mappings';
import { apiHeaders, appUrl, configureCsrf, sameOriginUrl } from './urls';
import { DEFAULT_SETTINGS, type CoreDescriptor, type Game, type Health, type LaunchInfo, type Library, type LibraryPageResult, type LibraryQuery, type SaveRecord, type Settings, type SupportAsset } from '../types';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const boolean = (value: unknown, fallback = false) => typeof value === 'boolean' ? value : fallback;
const nullableText = (value: unknown) => text(value) || null;
const unwrap = (value: unknown): unknown => object(value).data ?? value;
function externalLink(value: unknown): string | null {
  try { const url = new URL(text(value)); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export const localAssetUrl = sameOriginUrl;

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'ApiError'; }
}
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return '无法连接服务，请检查网络后重试。';
  return error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) ? error.message : '操作未完成，请稍后重试。';
}
async function checkResponse(response: Response): Promise<void> {
  if (response.ok) return;
  const payload: unknown = /json/.test(response.headers.get('content-type') || '') ? await response.json() : null;
  const detail = object(payload);
  const nested = object(detail.error);
  const message = text(detail.message) || text(detail.error) || text(nested.message);
  const code = text(nested.code ?? detail.code);
  const messages: Record<string, string> = {
    authentication_required: '登录已过期，请从飞牛应用入口重新打开。', csrf_required: '会话已变化，请刷新页面后再操作。',
    nas_unavailable: '当前运行环境未提供服务器目录。', invalid_rom: '卡带格式无效或文件已损坏，请检查后重新导入。',
    invalid_request: '请求内容无效，请检查文件与输入内容。', read_only: '内置卡带由安装包管理，不能更名或删除。',
    save_conflict: '另一设备已更新此存档，本地进度已保留，请下载或处理冲突。',
    precondition_failed: '存档版本已变化，本地进度已保留，请下载或处理冲突。',
    too_large: '文件超过服务允许的大小。', path_denied: '目录授权或读取权限已变化，请使用“添加卡带目录”选择并授权后刷新。',
    nas_refresh_required: '目录引用已失效，请刷新授权目录后重新选择。',
    incompatible_save: '此存档与当前核心版本或卡带不兼容。',
  };
  const defaults: Record<number, string> = {
    401: '登录已过期，请从飞牛应用入口重新打开。', 403: '当前账号没有执行此操作的权限。',
    404: '所请求的内容不存在，或服务尚未提供此功能。', 409: '内容已发生变化，请刷新后重试。', 410: '目录引用已失效，请刷新授权目录后重新选择。',
    412: '另一设备更新了此存档，请先重新读取，避免覆盖新进度。', 413: '文件超过服务允许的大小。',
    415: '服务不支持此文件格式。', 503: '服务暂不可用，请稍后重试。',
  };
  throw new ApiError((/[\u4e00-\u9fff]/.test(message) ? message : messages[code]) || defaults[response.status] || `请求失败（${response.status}），请重试。`, response.status);
}
async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = apiHeaders(init.headers);
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');
  let response: Response;
  try {
    response = await fetch(appUrl(`api${path}`), { credentials: 'same-origin', ...init, headers, signal: init.signal ?? AbortSignal.timeout(20_000) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new ApiError('服务响应超时，请稍后重试。', 0);
    throw error;
  }
  await checkResponse(response);
  if (response.status === 204) return null;
  if (!/json/.test(response.headers.get('content-type') || '')) throw new ApiError('服务返回了非 JSON 内容，请检查 API 地址。', response.status);
  return unwrap(await response.json());
}
export async function fetchBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const local = sameOriginUrl(url);
  if (!local) throw new ApiError('文件地址不属于当前应用。', 0);
  const response = await fetch(local, { credentials: 'same-origin', headers: apiHeaders(), signal: signal ?? AbortSignal.timeout(60_000) });
  await checkResponse(response);
  if (/text\/html/.test(response.headers.get('content-type') || '')) throw new ApiError('文件地址返回了网页，无法读取卡带或存档。', 200);
  return new Uint8Array(await response.arrayBuffer());
}
export function normalizeCore(value: unknown): CoreDescriptor | null {
  if (typeof value === 'boolean') return { available: value };
  const raw = object(value);
  if (!Object.keys(raw).length) return null;
  return {
    available: typeof raw.available === 'boolean' ? raw.available : undefined,
    moduleUrl: localAssetUrl(raw.moduleUrl ?? raw.module_url) ?? undefined,
    name: text(raw.name) || undefined, reason: text(raw.reason ?? raw.message) || undefined,
  };
}
export function normalizeGame(value: unknown): Game | null {
  const raw = object(value);
  const id = text(raw.id);
  if (!id) return null;
  const filename = text(raw.filename ?? raw.file_name ?? raw.fileName);
  const originalTitle = text(raw.originalTitle ?? raw.original_title);
  const suppliedTitle = text(raw.title ?? raw.name, filename || id);
  const title = originalTitle && suppliedTitle.endsWith(` · ${originalTitle}`) ? suppliedTitle.slice(0, -originalTitle.length - 3) : suppliedTitle;
  const tagValue = raw.tags ?? raw.categories;
  return {
    id, title, filename, description: text(raw.description),
    coverUrl: localAssetUrl(raw.cover_url ?? raw.coverUrl ?? raw.cover),
    favorite: boolean(raw.favorite ?? raw.is_favorite ?? raw.isFavorite),
    lastPlayedAt: nullableText(raw.last_played_at ?? raw.lastPlayedAt ?? raw.last_played ?? raw.lastPlayed),
    importedAt: nullableText(raw.imported_at ?? raw.importedAt ?? raw.added_at ?? raw.created_at ?? raw.createdAt),
    size: number(raw.size ?? raw.size_bytes ?? raw.sizeBytes), mapper: number(raw.mapper) ?? nullableText(raw.mapper),
    format: text(raw.format, 'NES'), system: text(raw.system, 'NES'), sha256: text(raw.sha256),
    author: text(raw.author), license: text(raw.license), sourceUrl: externalLink(raw.sourceUrl), readOnly: raw.source === 'bundled' || raw.readOnly === true,
    controls: text(raw.controls), category: text(raw.category), genre: text(raw.genre),
    language: text(raw.language), originalTitle: text(raw.originalTitle ?? raw.original_title), translationStatus: text(raw.translationStatus ?? raw.translation_status),
    source: raw.source === 'bundled' || raw.bundled === true || raw.readOnly === true ? 'bundled' : 'imported',
    tags: Array.isArray(tagValue) ? tagValue.filter((tag): tag is string => typeof tag === 'string') : [],
    keyboard: boolean(raw.keyboard ?? raw.supports_keyboard ?? raw.supportsKeyboard ?? raw.learning),
    playCount: number(raw.play_count ?? raw.playCount),
  };
}
function arrayFrom(value: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const raw = object(value);
  for (const key of keys) if (Array.isArray(raw[key])) return raw[key] as unknown[];
  throw new ApiError('服务返回的数据格式不正确。', 200);
}
function normalizeSave(value: unknown): SaveRecord | null {
  const raw = object(value);
  const id = text(raw.id);
  if (!id) return null;
  return {
    id, gameId: text(raw.gameId ?? raw.game_id ?? raw.game), kind: raw.kind === 'sram' ? 'sram' : 'state',
    slot: number(raw.slot) ?? 1, createdAt: nullableText(raw.updatedAt ?? raw.updated_at ?? raw.createdAt ?? raw.created_at),
    url: localAssetUrl(raw.url ?? raw.downloadUrl ?? raw.download_url), etag: nullableText(raw.etag ?? raw.eTag),
    core: text(raw.core), coreVersion: text(raw.coreVersion ?? raw.core_version), romSha256: text(raw.romSha256 ?? raw.rom_sha256),
    size: number(raw.size), thumbUrl: localAssetUrl(raw.thumbUrl ?? raw.thumb_url),
  };
}
export interface SaveUpload { game: Game; kind: 'state' | 'sram'; slot: number; core: string; coreVersion: string; bytes: Uint8Array; existing?: SaveRecord }
export interface NasEntry { path: string; name: string; kind: 'directory' | 'rom'; size?: number }
export interface NasRootDiagnostics { authorized: number; usable: number; invalidPath: number; aclDenied: number; directoryUnreadable: number; duplicate: number }
export interface NasRoots { available: boolean; roots: NasEntry[]; capabilities: { browse: boolean; importFiles: boolean; scan: boolean }; diagnostics?: NasRootDiagnostics; issue?: 'directoryUnreadable' }
export interface NasDirectory { path: string; parent: string | null; root: string; entries: NasEntry[]; truncated: boolean; skippedLinks?: number }
export interface NasFailure { path: string; code: string; message: string }
export interface ScanJob { id: string; path: string; status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'; visited: number; discovered: number; imported: number; skipped?: number; failed: number; errors: NasFailure[]; startedAt: string; finishedAt?: string }
export interface NasImportResult { games: unknown[]; imported: number; skipped?: number; failed: NasFailure[] }
export class NasRootsError extends ApiError {
  constructor(message: string, status: number, public readonly available: boolean) { super(message, status); }
}
function normalizeNasRoots(value: unknown, status: number): NasRoots {
  const raw = object(value);
  const invalid = () => new NasRootsError('服务器目录响应格式不正确，无法确认授权目录。请检查飞牛目录服务与应用版本是否兼容；刷新不会修复无效响应。', status, raw.available === true);
  const capabilities = object(raw.capabilities);
  if (typeof raw.available !== 'boolean' || !Array.isArray(raw.roots)
    || ['browse', 'importFiles', 'scan'].some((key) => typeof capabilities[key] !== 'boolean')) throw invalid();
  const roots: NasEntry[] = raw.roots.map((value) => {
    const entry = object(value);
    // The browser accepts only opaque references, never physical NAS paths.
    if (typeof entry.path !== 'string' || !/^nas_[A-Za-z0-9_-]+$/.test(entry.path) || typeof entry.name !== 'string' || !entry.name || /[/\\\x00-\x1f]/.test(entry.name) || entry.kind !== 'directory') throw invalid();
    return { path: entry.path, name: entry.name, kind: 'directory' };
  });
  let diagnostics: NasRootDiagnostics | undefined;
  if (raw.diagnostics !== undefined) {
    const detail = object(raw.diagnostics);
    const keys = ['authorized', 'usable', 'invalidPath', 'aclDenied', 'directoryUnreadable', 'duplicate'] as const;
    if (keys.some((key) => !Number.isSafeInteger(detail[key]) || (detail[key] as number) < 0)) throw invalid();
    diagnostics = Object.fromEntries(keys.map((key) => [key, detail[key]])) as unknown as NasRootDiagnostics;
    if (diagnostics.usable !== roots.length || diagnostics.authorized !== keys.slice(1).reduce((sum, key) => sum + diagnostics![key], 0)) throw invalid();
  }
  if (!raw.available && roots.length) throw invalid();
  return { available: raw.available, roots, capabilities: { browse: capabilities.browse as boolean, importFiles: capabilities.importFiles as boolean, scan: capabilities.scan as boolean }, ...(diagnostics ? { diagnostics } : {}) };
}
async function requestNasRoots(signal?: AbortSignal): Promise<NasRoots> {
  const headers = apiHeaders(); headers.set('Accept', 'application/json');
  let response: Response;
  try { response = await fetch(appUrl('api/nas/roots'), { credentials: 'same-origin', headers, signal: signal ?? AbortSignal.timeout(20_000) }); }
  catch (cause) {
    if (cause instanceof DOMException && cause.name === 'TimeoutError') throw new NasRootsError('服务器目录响应超时，请检查网络后重试。', 0, false);
    throw cause;
  }
  const isJson = /json/.test(response.headers.get('content-type') || '');
  let payload: unknown;
  try { payload = isJson ? await response.clone().json() : null; }
  catch { if (response.ok) throw new NasRootsError('服务器目录返回了无效 JSON，请检查目录服务与应用版本是否兼容。', response.status, false); }
  const raw = object(unwrap(payload));
  const code = text(object(raw.error).code ?? raw.code);
  if (!response.ok) {
    if ([400, 403].includes(response.status) && raw.available === true && ['nas_directory_unreadable', 'access_denied', 'unsafe_path'].includes(code)) {
      const roots = normalizeNasRoots(raw, response.status);
      if (!roots.diagnostics || !roots.diagnostics.authorized || roots.roots.length) throw new NasRootsError('服务器目录响应与授权状态不一致，请检查目录服务与应用版本。', response.status, true);
      return { ...roots, issue: 'directoryUnreadable' };
    }
    // Authentication/unavailable errors retain their usual behavior and never expose response grants.
    await checkResponse(response);
  }
  if (!isJson) throw new NasRootsError('服务器目录返回了非 JSON 内容，请检查 API 地址与应用版本。', response.status, false);
  return normalizeNasRoots(raw, response.status);
}
export interface RestoreResult { importedGames: number; existingGames: number; restoredSaves: number; restoredCovers?: number; conflicts: { kind: string; id: string; message: string }[]; settingsRestored: boolean }

export const api = {
  async health(signal?: AbortSignal): Promise<Health> {
    const raw = object(await request('/health', { signal }));
    configureCsrf(raw.csrfHeader, raw.csrfToken);
    return { online: raw.ok !== false && raw.status !== 'error' && raw.status !== 'unhealthy', version: nullableText(raw.version), core: normalizeCore(raw.core ?? raw.emulator) };
  },
  async library(signal?: AbortSignal): Promise<Library> {
    const raw = object(await request('/library', { signal }));
    const stats = Object.keys(object(raw.stats)).length ? object(raw.stats) : raw;
    return {
      total: number(stats.total ?? stats.total_games ?? stats.totalGames ?? stats.count) ?? (Array.isArray(raw.games) ? raw.games.length : null),
      favorites: number(stats.favorites ?? stats.favorite_count), recent: number(stats.recent ?? stats.recent_count),
      path: nullableText(raw.path ?? raw.library_path ?? raw.libraryPath), scannedAt: nullableText(raw.scanned_at ?? raw.scannedAt),
    };
  },
  async libraryPage(query: LibraryQuery, signal?: AbortSignal): Promise<LibraryPageResult> {
    if (!Number.isSafeInteger(query.page) || query.page < 1 || !Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 500
      || !['all', 'favorites', 'recent'].includes(query.view) || !['all', 'game', 'learning'].includes(query.category) || !['added', 'title', 'recent'].includes(query.sort)) {
      throw new ApiError('分页参数无效，每页条数须为 1–500 的整数。', 0);
    }
    const params = new URLSearchParams({ paginated: '1', page: String(query.page), pageSize: String(query.pageSize), view: query.view, category: query.category, sort: query.sort, search: query.search });
    const raw = object(await request(`/library?${params}`, { signal }));
    const integer = (value: unknown, minimum = 0): number => {
      const parsed = number(value);
      if (parsed === null || !Number.isSafeInteger(parsed) || parsed < minimum) throw new ApiError('服务返回的分页数据格式不正确。', 200);
      return parsed;
    };
    const stats = object(raw.stats);
    const result: LibraryPageResult = {
      games: arrayFrom(raw, 'games').map(normalizeGame).filter((game): game is Game => game !== null),
      total: integer(raw.total), page: integer(raw.page, 1), pageSize: integer(raw.pageSize, 1), totalPages: integer(raw.totalPages, 1),
      rangeStart: integer(raw.rangeStart), rangeEnd: integer(raw.rangeEnd),
      stats: { total: integer(stats.total), favorites: integer(stats.favorites), recent: integer(stats.recent) },
    };
    if (result.pageSize !== query.pageSize || result.totalPages !== Math.max(1, Math.ceil(result.total / result.pageSize))
      || result.page !== Math.min(query.page, result.totalPages) || result.games.length !== Math.min(result.pageSize, Math.max(0, result.total - (result.page - 1) * result.pageSize))
      || result.rangeStart !== (result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1) || result.rangeEnd !== (result.total === 0 ? 0 : result.rangeStart + result.games.length - 1)) {
      throw new ApiError('服务返回的分页范围不一致，请刷新卡带库。', 200);
    }
    return result;
  },
  async games(signal?: AbortSignal): Promise<Game[]> {
    return arrayFrom(await request('/games', { signal }), 'games', 'items').map(normalizeGame).filter((game): game is Game => game !== null);
  },
  async game(id: string, signal?: AbortSignal): Promise<Game> {
    const payload = await request(`/games/${encodeURIComponent(id)}`, { signal });
    const game = normalizeGame(object(payload).game ?? payload);
    if (!game) throw new ApiError('游戏详情格式不正确。', 200);
    return game;
  },
  async rename(id: string, title: string): Promise<void> { await request(`/games/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ title }) }); },
  async deleteGame(id: string): Promise<void> { await request(`/games/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  async favorite(id: string, favorite: boolean): Promise<void> { await request(`/games/${encodeURIComponent(id)}/favorite`, { method: 'PUT', body: JSON.stringify({ favorite }) }); },
  async uploadCover(id: string, data: Blob | Uint8Array): Promise<Game> {
    const body = data instanceof Blob ? data : new Blob([new Uint8Array(data)], { type: 'image/png' });
    const payload = await request(`/games/${encodeURIComponent(id)}/cover`, {
      method: 'PUT',
      headers: { 'Content-Type': body.type || 'image/png' },
      body,
    });
    const game = normalizeGame(object(payload).game ?? payload);
    if (!game) throw new ApiError('封面更新响应格式不正确。', 200);
    return game;
  },
  async deleteCover(id: string): Promise<Game> {
    const payload = await request(`/games/${encodeURIComponent(id)}/cover`, { method: 'DELETE' });
    const game = normalizeGame(object(payload).game ?? payload);
    if (!game) throw new ApiError('封面删除响应格式不正确。', 200);
    return game;
  },
  async importGame(file: File, title?: string): Promise<Game | null> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (title?.trim()) form.append('title', title.trim());
    const payload = await request('/games', { method: 'POST', body: form, signal: AbortSignal.timeout(180_000) });
    const raw = object(payload);
    return normalizeGame(raw.game ?? (Array.isArray(raw.games) ? raw.games[0] : payload));
  },
  async launch(id: string, signal?: AbortSignal): Promise<LaunchInfo> {
    const raw = object(await request(`/games/${encodeURIComponent(id)}/launch`, { method: 'POST', signal }));
    return { romUrl: localAssetUrl(raw.romUrl ?? raw.rom_url ?? raw.url), core: normalizeCore(raw.core ?? raw.emulator), keyboard: boolean(raw.keyboard ?? object(raw.game).keyboard) };
  },
  async saves(gameId: string, signal?: AbortSignal): Promise<SaveRecord[]> {
    return arrayFrom(await request(`/saves?game=${encodeURIComponent(gameId)}`, { signal }), 'saves', 'items').map(normalizeSave).filter((save): save is SaveRecord => save !== null);
  },
  async save({ game, kind, slot, core, coreVersion, bytes, existing }: SaveUpload): Promise<SaveRecord> {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
    let payload: unknown;
    if (existing) {
      if (!existing.etag) throw new ApiError('存档缺少版本标识，请刷新存档列表后重试。', 412);
      if (existing.core !== core || existing.coreVersion !== coreVersion || existing.romSha256 !== game.sha256) throw new ApiError('已有存档与当前核心或卡带不兼容，请使用空槽位。', 409);
      payload = await request(`/saves/${encodeURIComponent(existing.id)}`, { method: 'PUT', headers: {
        'Content-Type': 'application/octet-stream', 'If-Match': existing.etag,
        'X-XNBW-Core': core, 'X-XNBW-Core-Version': coreVersion, 'X-XNBW-ROM-SHA256': game.sha256,
      }, body: blob });
    } else {
      const form = new FormData();
      form.append('gameId', game.id); form.append('kind', kind); form.append('slot', String(slot));
      form.append('core', core); form.append('coreVersion', coreVersion); form.append('romSha256', game.sha256);
      form.append('file', blob, `${game.id}.${kind === 'state' ? 'state' : 'sav'}`);
      payload = await request('/saves', { method: 'POST', body: form });
    }
    const saved = normalizeSave(object(payload).save ?? payload);
    if (!saved || !saved.etag) throw new ApiError('服务没有返回存档版本，请刷新列表核对保存结果。', 200);
    return saved;
  },
  async saveBytes(save: SaveRecord): Promise<Uint8Array> { return fetchBytes(save.url || appUrl(`api/saves/${encodeURIComponent(save.id)}`)); },
  async uploadSaveThumb(saveId: string, data: Blob | Uint8Array): Promise<SaveRecord | null> {
    const body = data instanceof Blob ? data : new Blob([new Uint8Array(data)], { type: 'image/png' });
    const payload = await request(`/saves/${encodeURIComponent(saveId)}/thumb`, {
      method: 'PUT',
      headers: { 'Content-Type': body.type || 'image/png' },
      body,
    });
    return normalizeSave(object(payload).save ?? payload);
  },
  async deleteSave(save: SaveRecord): Promise<void> {
    if (!save.etag) throw new ApiError('存档缺少版本标识，请刷新存档列表后重试。', 412);
    await request(`/saves/${encodeURIComponent(save.id)}`, { method: 'DELETE', headers: { 'If-Match': save.etag } });
  },
  async settings(signal?: AbortSignal): Promise<Settings> {
    const payload = await request('/settings', { signal });
    const raw = object(object(payload).settings ?? payload);
    const defaultTouchControls = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : true;
    return {
      ...raw, volume: Math.max(0, Math.min(1, number(raw.volume) ?? DEFAULT_SETTINGS.volume)), muted: boolean(raw.muted),
      pixelated: boolean(raw.pixelated, true), showTouchControls: boolean(raw.showTouchControls ?? raw.show_touch_controls, defaultTouchControls),
      keyboardMappings: normalizeMappings(raw.keyboardMappings),
      touchSize: Math.max(0.85, Math.min(1.2, number(raw.touchSize) ?? 1)),
      touchOpacity: Math.max(0.3, Math.min(1, number(raw.touchOpacity) ?? 1)),
      touchPosition: raw.touchPosition === 'left' || raw.touchPosition === 'right' ? raw.touchPosition : 'center',
      aspectRatio: raw.aspectRatio === 'pixel' || raw.aspectRatio === 'stretch' ? raw.aspectRatio : '4:3',
      crt: boolean(raw.crt),
    };
  },
  async updateSettings(settings: Settings): Promise<void> { await request('/settings', { method: 'PUT', body: JSON.stringify(settings) }); },
  async nasRoots(signal?: AbortSignal): Promise<NasRoots> { return requestNasRoots(signal); },
  async nasBrowse(path: string, signal?: AbortSignal): Promise<NasDirectory> { return await request(`/nas/browse?path=${encodeURIComponent(path)}`, { signal }) as NasDirectory; },
  async nasImport(paths: string[]): Promise<NasImportResult> { return await request('/nas/import', { method: 'POST', body: JSON.stringify({ paths }), signal: AbortSignal.timeout(180_000) }) as NasImportResult; },
  async nasScan(path: string): Promise<ScanJob> { return await request('/nas/scan', { method: 'POST', body: JSON.stringify({ path }) }) as ScanJob; },
  async nasScanStatus(id: string, signal?: AbortSignal): Promise<ScanJob> { return await request(`/nas/scan/${encodeURIComponent(id)}`, { signal }) as ScanJob; },
  async nasCancelScan(id: string): Promise<ScanJob> { return await request(`/nas/scan/${encodeURIComponent(id)}`, { method: 'DELETE' }) as ScanJob; },
  async backup(mode: 'full' | 'saves' = 'full'): Promise<Uint8Array> {
    return fetchBytes(appUrl(mode === 'saves' ? 'api/backup?mode=saves' : 'api/backup'));
  },
  async restore(file: File): Promise<RestoreResult> {
    const form = new FormData(); form.append('file', file, file.name);
    return await request('/backup/restore', { method: 'POST', body: form, signal: AbortSignal.timeout(180_000) }) as RestoreResult;
  },
  async supportAssets(signal?: AbortSignal): Promise<SupportAsset[]> {
    const payload = await request('/support-assets', { signal });
    const raw = object(payload);
    const assets: unknown[] = Array.isArray(payload) ? payload : Array.isArray(raw.assets) ? raw.assets : [];
    if (!assets.length && raw.disabled !== true) throw new ApiError('内置赞赏码暂时无法读取，请检查应用启动日志后重试。', 503);
    const result = assets.flatMap((value) => {
      const asset = typeof value === 'string' ? { url: value } : object(value);
      const url = localAssetUrl(asset.url ?? asset.path);
      if (!url) return [];
      const kind = text(asset.kind ?? asset.type ?? asset.name);
      if (['logo', 'brand'].includes(kind)) return [];
      return [{ kind, label: text(asset.label, kind === 'wechat' ? '微信支持' : kind === 'alipay' ? '支付宝支持' : '支持项目'), url }];
    });
    if (assets.length && !result.length) throw new ApiError('赞赏码资源地址无效，请检查应用安装资源后重试。', 503);
    return result;
  },
};
