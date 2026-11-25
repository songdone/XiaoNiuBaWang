import { useEffect, useState } from 'react';

export type Route = { page: 'library' } | { page: 'game'; id: string } | { page: 'player'; id: string; slot?: number };
export type NavigationGuard = (target: Route) => Promise<boolean> | boolean;
export function currentRoute(): Route {
  const match = window.location.hash.match(/^#\/(game|play)\/([^/?]+)(?:\?slot=(\d+))?$/);
  if (!match) return { page: 'library' };
  try {
    const id = decodeURIComponent(match[2]);
    if (match[1] === 'play') {
      const parsed = match[3] ? Number(match[3]) : undefined;
      const slot = parsed && Number.isInteger(parsed) && parsed >= 1 && parsed <= 10 ? parsed : undefined;
      return slot ? { page: 'player', id, slot } : { page: 'player', id };
    }
    return { page: 'game', id };
  }
  catch { return { page: 'library' }; }
}
function routeHash(route: Route) {
  if (route.page === 'library') return '#/';
  if (route.page === 'player') {
    const base = `#/play/${encodeURIComponent(route.id)}`;
    return route.slot ? `${base}?slot=${route.slot}` : base;
  }
  return `#/game/${encodeURIComponent(route.id)}`;
}
function equal(a: Route, b: Route) { return routeHash(a) === routeHash(b); }
let accepted: Route | null = null;
let guard: NavigationGuard | null = null;
let requesting = false;
const listeners = new Set<(route: Route) => void>();

/** Keep the currently rendered Player mounted until its asynchronous exit decision completes. */
export function registerNavigationGuard(next: NavigationGuard) {
  guard = next;
  return () => { if (guard === next) guard = null; };
}
async function requestNavigation(target: Route, fromHistory = false): Promise<boolean> {
  const previous = accepted ?? currentRoute();
  if (equal(previous, target)) return true;
  // A second click/back must not replace an outstanding save/confirmation decision.
  if (requesting) return false;
  requesting = true;
  try {
    if (guard && !await guard(target)) return false;
    accepted = target;
    if (fromHistory) window.history.replaceState(null, '', routeHash(target));
    else window.location.hash = routeHash(target);
    for (const listener of listeners) listener(target);
    window.scrollTo(0, 0);
    return true;
  } catch { return false; }
  finally { requesting = false; }
}
export function navigate(page: 'library' | 'game' | 'player', id?: string, slot?: number): Promise<boolean> {
  if (page === 'library') return requestNavigation({ page });
  if (page === 'player') return requestNavigation(slot ? { page, id: id || '', slot } : { page, id: id || '' });
  return requestNavigation({ page, id: id || '' });
}
function onHashChange() {
  const target = currentRoute();
  const previous = accepted ?? target;
  if (equal(previous, target)) return;
  // Hash links and browser back/forward change the URL before the event. Restore it
  // synchronously; never render the destination (and destroy Player) before approval.
  window.history.replaceState(null, '', routeHash(previous));
  void requestNavigation(target, true);
}
export function useRoute() {
  const [route, setRoute] = useState(() => accepted ?? currentRoute());
  useEffect(() => {
    if (!listeners.size) {
      accepted = currentRoute();
      window.addEventListener('hashchange', onHashChange);
    }
    setRoute(accepted!);
    listeners.add(setRoute);
    return () => {
      listeners.delete(setRoute);
      if (!listeners.size) { window.removeEventListener('hashchange', onHashChange); accepted = null; }
    };
  }, []);
  return route;
}
