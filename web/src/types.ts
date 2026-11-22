import brand from '../../branding/brand.json';
import { DEFAULT_MAPPINGS, type InputMappings } from './input/mappings';

export const APP_NAME = brand.name;
export const APP_SHORT_NAME = brand.shortName;
export const APP_VERSION = brand.version;
export const BRAND_LOGO = brand.logo;
export const GATEWAY_PREFIX = brand.gatewayPrefix;

export interface Game {
  id: string;
  title: string;
  filename: string;
  description: string;
  coverUrl: string | null;
  favorite: boolean;
  lastPlayedAt: string | null;
  importedAt: string | null;
  size: number | null;
  mapper: number | string | null;
  format: string;
  tags: string[];
  keyboard: boolean;
  playCount: number | null;
  sha256: string;
  system: string;
  source: 'bundled' | 'imported';
  author: string;
  license: string;
  sourceUrl: string | null;
  readOnly: boolean;
  controls: string;
  category: string;
  genre: string;
  language: string;
  originalTitle: string;
  translationStatus: string;
}

export interface CoreDescriptor {
  available?: boolean;
  moduleUrl?: string;
  name?: string;
  reason?: string;
}

export interface Health {
  online: boolean;
  version: string | null;
  core: CoreDescriptor | null;
}

export interface Library {
  total: number | null;
  favorites: number | null;
  recent: number | null;
  path: string | null;
  scannedAt: string | null;
}

export interface Settings {
  volume: number;
  muted: boolean;
  pixelated: boolean;
  showTouchControls: boolean;
  keyboardMappings: InputMappings;
  touchSize: number;
  touchOpacity: number;
  touchPosition: 'left' | 'center' | 'right';
  aspectRatio: '4:3' | 'pixel' | 'stretch';
  crt: boolean;
  [key: string]: unknown;
}

export interface SaveRecord {
  id: string;
  gameId: string;
  kind: 'sram' | 'state';
  slot: number;
  createdAt: string | null;
  url: string | null;
  etag: string | null;
  core: string;
  coreVersion: string;
  romSha256: string;
  size: number | null;
}

export interface LaunchInfo {
  romUrl: string | null;
  core: CoreDescriptor | null;
  keyboard: boolean;
}

export interface SupportAsset {
  kind: string;
  label: string;
  url: string;
}

export type LibraryView = 'all' | 'favorites' | 'recent';
export type LibraryCategory = 'all' | 'game' | 'learning';
export type LibrarySort = 'added' | 'title' | 'recent';
export type LibraryPageSize = number | 'all';
export interface LibraryQuery {
  page: number;
  pageSize: number;
  view: LibraryView;
  category: LibraryCategory;
  sort: LibrarySort;
  search: string;
}
export interface LibraryStats { total: number; favorites: number; recent: number }
export interface LibraryPageResult {
  games: Game[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
  stats: LibraryStats;
}
export interface LibraryPreferences {
  view: LibraryView;
  category: LibraryCategory;
  sort: LibrarySort;
  search: string;
  layout: 'grid' | 'list';
  page: number;
  pageSize: LibraryPageSize;
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.7,
  muted: false,
  pixelated: true,
  showTouchControls: true,
  keyboardMappings: DEFAULT_MAPPINGS,
  touchSize: 1,
  touchOpacity: 1,
  touchPosition: 'center',
  aspectRatio: '4:3',
  crt: false,
};
