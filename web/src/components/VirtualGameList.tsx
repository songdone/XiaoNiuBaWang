import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Game } from '../types';

/** Window-scrolled rows: only the viewport, overscan and a focused row are mounted. */
export function VirtualGameList({ games, layout, renderGame }: { games: Game[]; layout: 'grid' | 'list'; renderGame: (game: Game, index: number) => ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const rowObserver = useRef<ResizeObserver | null>(null);
  const [columns, setColumns] = useState(1);
  const [estimate, setEstimate] = useState(layout === 'list' ? 180 : 400);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const [viewport, setViewport] = useState({ top: 0, height: window.innerHeight || 900 });
  const [focused, setFocused] = useState<number | null>(null);
  const [pendingFocus, setPendingFocus] = useState<{ index: number; last: boolean } | null>(null);
  const rowCount = Math.ceil(games.length / columns);
  const offsets = useMemo(() => {
    const values = [0];
    for (let row = 0; row < rowCount; row++) values.push(values[row] + (heights[row] ?? estimate));
    return values;
  }, [rowCount, heights, estimate]);
  const offsetsRef = useRef(offsets);
  const rowNodes = useRef(new Map<number, HTMLDivElement>());
  useLayoutEffect(() => {
    const previous = offsetsRef.current;
    offsetsRef.current = offsets;
    const node = container.current;
    if (!node || node.getBoundingClientRect().top >= 0 || previous.length < 2) return;
    const top = -node.getBoundingClientRect().top;
    let anchor = 0;
    while (anchor < previous.length - 2 && previous[anchor + 1] < top) anchor++;
    const delta = (offsets[anchor] ?? 0) - previous[anchor];
    if (Math.abs(delta) > 1) { window.scrollTo(0, window.scrollY + delta); setViewport((current) => ({ ...current, top: Math.max(0, current.top + delta) })); }
  }, [offsets]);
  const measureViewport = useCallback(() => {
    const node = container.current; if (!node) return;
    setViewport({ top: Math.max(0, -node.getBoundingClientRect().top), height: window.innerHeight || 900 });
  }, []);
  useLayoutEffect(() => {
    const node = container.current; if (!node) return;
    let width = -1;
    const resize = () => {
      const nextWidth = node.getBoundingClientRect().width;
      const nextColumns = layout === 'list' ? 1 : Number(getComputedStyle(node).getPropertyValue('--virtual-columns')) || 2;
      if (nextWidth !== width) {
        width = nextWidth; setColumns(nextColumns); setHeights({});
        const cardWidth = (nextWidth - (nextColumns - 1) * 22) / nextColumns;
        setEstimate(layout === 'list' ? (window.innerWidth <= 820 ? 210 : 160) : Math.max(250, cardWidth / 1.07 + 220));
      }
      measureViewport();
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize); observer?.observe(node);
    let frame = 0;
    const scroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measureViewport); };
    window.addEventListener('scroll', scroll, { passive: true }); window.addEventListener('resize', resize);
    return () => { observer?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('scroll', scroll); window.removeEventListener('resize', resize); };
  }, [layout, measureViewport]);
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const changes: Record<number, number> = {};
      for (const entry of entries) {
        const row = Number((entry.target as HTMLElement).dataset.row);
        const measured = entry.target.getBoundingClientRect().height;
        if (measured > 0) changes[row] = measured + (layout === 'list' ? 12 : 22);
      }
      setHeights((previous) => {
        let changed = false;
        for (const [row, value] of Object.entries(changes)) if (Math.abs((previous[Number(row)] ?? estimate) - value) > 1) changed = true;
        return changed ? { ...previous, ...changes } : previous;
      });
    });
    rowObserver.current = observer;
    container.current?.querySelectorAll('[data-row]').forEach((node) => observer.observe(node));
    return () => { observer.disconnect(); rowObserver.current = null; };
  }, [layout, columns, estimate]);
  const firstGameId = games[0]?.id;
  useEffect(() => { setHeights({}); setFocused(null); }, [firstGameId, layout]);
  let start = 0;
  while (start < rowCount && offsets[start + 1] < viewport.top) start++;
  let end = start;
  while (end < rowCount && offsets[end] < viewport.top + viewport.height) end++;
  start = Math.max(0, start - 3); end = Math.min(rowCount, end + 3);
  const mountedRows = new Set<number>();
  for (let row = start; row < end; row++) mountedRows.add(row);
  if (focused !== null && focused < games.length) mountedRows.add(Math.floor(focused / columns));
  if (pendingFocus) mountedRows.add(Math.floor(pendingFocus.index / columns));
  useLayoutEffect(() => {
    if (!pendingFocus) return;
    const card = container.current?.querySelector(`[data-game-index="${pendingFocus.index}"]`);
    const buttons = card?.querySelectorAll<HTMLButtonElement>('button:not(:disabled), a[href]');
    const target = pendingFocus.last ? buttons?.[buttons.length - 1] : buttons?.[0];
    if (target) { target.focus({ preventScroll: true }); target.scrollIntoView?.({ block: 'nearest' }); measureViewport(); setPendingFocus(null); }
  }, [pendingFocus, measureViewport]);
  const rowRef = (row: number, node: HTMLDivElement | null) => {
    const previous = rowNodes.current.get(row);
    if (previous) rowObserver.current?.unobserve(previous);
    if (node) { rowNodes.current.set(row, node); rowObserver.current?.observe(node); }
    else rowNodes.current.delete(row);
  };
  return <div ref={container} className={`virtual-game-list virtual-${layout}`} style={{ height: offsets[rowCount] }} onFocusCapture={(event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-game-index]'); if (card) setFocused(Number(card.dataset.gameIndex));
  }} onBlurCapture={(event) => { if (!container.current?.contains(event.relatedTarget as Node)) setFocused(null); }} onKeyDown={(event) => {
    if (event.key !== 'Tab') return;
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-game-index]'); if (!card) return;
    const index = Number(card.dataset.gameIndex);
    const buttons = card.querySelectorAll('button:not(:disabled), a[href]');
    const boundary = event.shiftKey ? buttons[0] : buttons[buttons.length - 1];
    const next = index + (event.shiftKey ? -1 : 1);
    if (event.target !== boundary || next < 0 || next >= games.length || container.current?.querySelector(`[data-game-index="${next}"]`)) return;
    event.preventDefault(); setPendingFocus({ index: next, last: event.shiftKey });
  }}>
    {[...mountedRows].sort((a, b) => a - b).map((row) => <div key={row} ref={(node) => rowRef(row, node)} data-row={row} className={`virtual-game-row game-${layout}`} style={{ transform: `translateY(${offsets[row]}px)` }}>
      {games.slice(row * columns, (row + 1) * columns).map((game, index) => renderGame(game, row * columns + index))}
    </div>)}
  </div>;
}
