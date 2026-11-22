import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { GATEWAY_PREFIX, type Game, type LibraryPageResult, type LibraryPreferences, type LibraryQuery } from '../types';

export const LIBRARY_PREFERENCES_KEY = `${GATEWAY_PREFIX}:library-ui:v1`;
const defaults: LibraryPreferences = { view: 'all', category: 'all', sort: 'added', search: '', layout: 'grid', page: 1, pageSize: 20 };
function readPreferences(): LibraryPreferences {
  try {
    const raw = JSON.parse(sessionStorage.getItem(LIBRARY_PREFERENCES_KEY) || '{}');
    return {
      view: ['all', 'favorites', 'recent'].includes(raw.view) ? raw.view : defaults.view,
      category: ['all', 'game', 'learning'].includes(raw.category) ? raw.category : defaults.category,
      sort: ['added', 'title', 'recent'].includes(raw.sort) ? raw.sort : defaults.sort,
      search: typeof raw.search === 'string' ? raw.search : '', layout: raw.layout === 'list' ? 'list' : 'grid',
      page: Number.isSafeInteger(raw.page) && raw.page > 0 && raw.pageSize !== 'all' ? raw.page : 1,
      pageSize: raw.pageSize === 'all' || Number.isInteger(raw.pageSize) && raw.pageSize >= 1 && raw.pageSize <= 500 ? raw.pageSize : 20,
    };
  } catch { return { ...defaults }; }
}
export type AllLoadStatus = 'idle' | 'loading' | 'complete' | 'cancelled' | 'changed' | 'failed';
export function useLibraryQuery() {
  const [preferences, setPreferences] = useState(readPreferences);
  const [debouncedSearch, setDebouncedSearch] = useState(preferences.search);
  const [result, setResult] = useState<LibraryPageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [allStatus, setAllStatus] = useState<AllLoadStatus>('idle');
  const [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const skipClampRequest = useRef<string | null>(null);
  const abort = useCallback(() => { generation.current++; request.current?.abort(); }, []);
  const change = useCallback((patch: Partial<LibraryPreferences>) => {
    if (!Object.keys(patch).some((key) => patch[key as keyof LibraryPreferences] !== preferences[key as keyof LibraryPreferences])) return;
    // Abort in the same turn, including the 250 ms before the new search is sent.
    if (Object.keys(patch).some((key) => key !== 'layout')) abort();
    setPreferences((current) => {
      const reset = ['search', 'category', 'view', 'sort', 'pageSize'].some((key) => key in patch && patch[key as keyof LibraryPreferences] !== current[key as keyof LibraryPreferences]);
      return { ...current, ...patch, ...(reset ? { page: 1 } : {}) };
    });
  }, [abort, preferences]);
  const refresh = useCallback(() => { abort(); setRevision((value) => value + 1); }, [abort]);
  const cancelAll = useCallback(() => { abort(); setLoading(false); setAllStatus('cancelled'); }, [abort]);
  useEffect(() => {
    try { sessionStorage.setItem(LIBRARY_PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* UI still works with storage disabled. */ }
  }, [preferences]);
  useEffect(() => {
    if (preferences.search === debouncedSearch) return;
    const timer = window.setTimeout(() => setDebouncedSearch(preferences.search), 250);
    return () => window.clearTimeout(timer);
  }, [preferences.search, debouncedSearch]);
  const { page, pageSize, view, category, sort, search } = preferences;
  useEffect(() => {
    const effectKey = JSON.stringify([page, pageSize, view, category, sort, search, debouncedSearch, revision]);
    const canonicalKey = skipClampRequest.current;
    skipClampRequest.current = null;
    if (canonicalKey === effectKey) return;
    if (search !== debouncedSearch) { setLoading(true); return; }
    const controller = new AbortController(); request.current = controller;
    const token = ++generation.current;
    const current = () => !controller.signal.aborted && generation.current === token;
    const query: LibraryQuery = { page, pageSize: pageSize === 'all' ? 500 : pageSize, view, category, sort: view === 'recent' ? 'recent' : sort, search: debouncedSearch.trim() };
    setLoading(true); setError(''); setAllStatus(pageSize === 'all' ? 'loading' : 'idle');
    if (pageSize === 'all') setResult((previous) => previous ? { ...previous, games: [], rangeStart: 0, rangeEnd: 0, page: 1 } : null);
    void (async () => {
      try {
        if (pageSize !== 'all') {
          const response = await api.libraryPage(query, controller.signal);
          if (!current()) return;
          setResult(response);
          if (response.page !== page) {
            skipClampRequest.current = JSON.stringify([response.page, pageSize, view, category, sort, search, debouncedSearch, revision]);
            setPreferences((previous) => ({ ...previous, page: response.page }));
          }
        } else {
          const games: Game[] = []; const ids = new Set<string>();
          let expectedTotal: number | null = null;
          for (let batch = 1; ; batch++) {
            const response = await api.libraryPage({ ...query, page: batch }, controller.signal);
            if (!current()) return;
            if (expectedTotal !== null && (response.total !== expectedTotal || response.page !== batch)) {
              setAllStatus('changed'); setError('加载期间卡带库数量发生变化，已停止。请刷新后重新加载全部卡带。'); return;
            }
            expectedTotal = response.total;
            let duplicate = false;
            for (const game of response.games) {
              if (ids.has(game.id)) { duplicate = true; continue; }
              ids.add(game.id); games.push(game);
            }
            setResult({ ...response, games: [...games], page: 1, rangeStart: games.length ? 1 : 0, rangeEnd: games.length });
            if (duplicate) { setAllStatus('changed'); setError('加载期间发现重复卡带，已停止。请刷新后重新加载全部卡带。'); return; }
            if (games.length === expectedTotal) { setAllStatus('complete'); break; }
            if (batch >= response.totalPages || !response.games.length) {
              setAllStatus('changed'); setError('全部卡带尚未读取完整，已停止。请刷新后重试。'); return;
            }
          }
        }
      } catch (cause) {
        if (!current()) return;
        setError(errorMessage(cause)); if (pageSize === 'all') setAllStatus('failed');
      } finally { if (current()) setLoading(false); }
    })();
    return () => controller.abort();
  }, [page, pageSize, view, category, sort, search, debouncedSearch, revision]);
  useEffect(() => () => abort(), [abort]);
  return { preferences, change, result, loading, error, allStatus, refresh, cancelAll };
}
export type LibraryQueryState = ReturnType<typeof useLibraryQuery>;
