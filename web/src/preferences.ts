import { useEffect, useState } from 'react';

export type ColorSchemePreference = 'system' | 'light' | 'dark';

export interface LocalPreferences {
  colorScheme: ColorSchemePreference;
  autoPauseOnBlur: boolean;
  touchHaptics: boolean;
  autoSaveOnExit: boolean;
}

const COLOR_SCHEME_KEY = 'xnbw:color-scheme';
const AUTO_PAUSE_KEY = 'xnbw:auto-pause-blur';
const TOUCH_HAPTICS_KEY = 'xnbw:touch-haptics';
const AUTO_SAVE_EXIT_KEY = 'xnbw:auto-save-exit';

const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.getItem === 'function') {
      return window.localStorage;
    }
  } catch { /* Storage blocked in private/sandboxed iframe. */ }
  return null;
}

function readFromStorage(): LocalPreferences {
  const store = storage();
  let colorScheme: ColorSchemePreference = 'system';
  let autoPauseOnBlur = true;
  let touchHaptics = true;
  let autoSaveOnExit = false;
  if (store) {
    try {
      const raw = store.getItem(COLOR_SCHEME_KEY);
      if (raw === 'light' || raw === 'dark') colorScheme = raw;
      autoPauseOnBlur = store.getItem(AUTO_PAUSE_KEY) !== '0';
      touchHaptics = store.getItem(TOUCH_HAPTICS_KEY) !== '0';
      autoSaveOnExit = store.getItem(AUTO_SAVE_EXIT_KEY) === '1';
    } catch { /* Keep defaults when storage reads throw. */ }
  }
  return { colorScheme, autoPauseOnBlur, touchHaptics, autoSaveOnExit };
}

let current: LocalPreferences = readFromStorage();

function syncDocumentMeta(scheme: ColorSchemePreference) {
  if (typeof document === 'undefined') return;
  const metaContent = scheme === 'system' ? 'light dark' : scheme;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'color-scheme';
    document.head.appendChild(meta);
  }
  if (meta.content !== metaContent) meta.content = metaContent;
}

function notify() {
  for (const listener of listeners) listener();
}

export function applyColorScheme(value: ColorSchemePreference): void {
  current = { ...current, colorScheme: value };
  const store = storage();
  if (store) {
    try {
      if (value === 'system') store.removeItem(COLOR_SCHEME_KEY);
      else store.setItem(COLOR_SCHEME_KEY, value);
    } catch { /* Theme still applies in memory & DOM even when storage is blocked. */ }
  }
  syncDocumentMeta(value);
  notify();
}

export function setAutoPauseOnBlur(enabled: boolean): void {
  current = { ...current, autoPauseOnBlur: enabled };
  const store = storage();
  if (store) {
    try {
      if (enabled) store.removeItem(AUTO_PAUSE_KEY);
      else store.setItem(AUTO_PAUSE_KEY, '0');
    } catch { /* Preference still applies in memory. */ }
  }
  notify();
}

export function setTouchHaptics(enabled: boolean): void {
  current = { ...current, touchHaptics: enabled };
  const store = storage();
  if (store) {
    try {
      if (enabled) store.removeItem(TOUCH_HAPTICS_KEY);
      else store.setItem(TOUCH_HAPTICS_KEY, '0');
    } catch { /* Preference still applies in memory. */ }
  }
  notify();
}

export function setAutoSaveOnExit(enabled: boolean): void {
  current = { ...current, autoSaveOnExit: enabled };
  const store = storage();
  if (store) {
    try {
      if (enabled) store.setItem(AUTO_SAVE_EXIT_KEY, '1');
      else store.removeItem(AUTO_SAVE_EXIT_KEY);
    } catch { /* Preference still applies in memory. */ }
  }
  notify();
}

export function readLocalPreferences(): LocalPreferences {
  return current;
}

export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(media.matches);
    setDark(media.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);
  return dark;
}

export function useLocalPreferences(): LocalPreferences {
  const [prefs, setPrefs] = useState<LocalPreferences>(readLocalPreferences);
  useEffect(() => {
    const syncLocal = () => setPrefs(readLocalPreferences());
    const syncCrossTab = (event: StorageEvent) => {
      if (event.key && ![COLOR_SCHEME_KEY, AUTO_PAUSE_KEY, TOUCH_HAPTICS_KEY].includes(event.key)) return;
      current = readFromStorage();
      syncDocumentMeta(current.colorScheme);
      setPrefs(current);
    };
    listeners.add(syncLocal);
    window.addEventListener('storage', syncCrossTab);
    return () => {
      listeners.delete(syncLocal);
      window.removeEventListener('storage', syncCrossTab);
    };
  }, []);
  return prefs;
}
