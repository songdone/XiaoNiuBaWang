import { useLayoutEffect, useState, type RefObject } from 'react';

export function usePlayerViewport(machine: RefObject<HTMLElement | null>, viewport: RefObject<HTMLElement | null>, expanded: boolean, revision: unknown) {
  const [height, setHeight] = useState<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const element = machine.current;
      if (!element) return;
      const available = window.visualViewport?.height ?? window.innerHeight;
      const top = expanded ? 0 : Math.max(0, element.getBoundingClientRect().top);
      setHeight(Math.max(240, Math.floor(available - top - (expanded ? 0 : 12))));
      const area = viewport.current;
      if (area) {
        const bounds = area.getBoundingClientRect();
        const next = { width: Math.floor(bounds.width), height: Math.floor(bounds.height) };
        setSize((old) => old.width === next.width && old.height === next.height ? old : next);
      }
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (machine.current) observer?.observe(machine.current);
    if (viewport.current) observer?.observe(viewport.current);
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [machine, viewport, expanded, revision]);
  return { height, size };
}
