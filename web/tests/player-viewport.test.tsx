// Hook tests use explicit layout/ResizeObserver/visualViewport boundaries, not browser CSS or WASM E2E.
import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerViewport } from '../src/hooks/usePlayerViewport';

let machineTop: number;
let viewportBounds: { width: number; height: number };
let visual: EventTarget & { height: number };
let restoreViewport: () => void;
let observers: MockResizeObserver[];
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(private callback: ResizeObserverCallback) { observers.push(this); }
  notify() { this.callback([], this as unknown as ResizeObserver); }
}
function Harness({ expanded = false, revision = '' }: { expanded?: boolean; revision?: string }) {
  const machine = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const measured = usePlayerViewport(machine, viewport, expanded, revision);
  return <div ref={machine} data-testid="machine"><div ref={viewport} data-testid="viewport"/><output data-testid="measurements">{JSON.stringify(measured)}</output></div>;
}
const measurements = () => JSON.parse(screen.getByTestId('measurements').textContent!) as { height: number; size: { width: number; height: number } };

beforeEach(() => {
  machineTop = 100.4; viewportBounds = { width: 640.8, height: 400.9 }; observers = [];
  visual = Object.assign(new EventTarget(), { height: 800.9 });
  const previous = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
  restoreViewport = () => { if (previous) Object.defineProperty(window, 'visualViewport', previous); else Reflect.deleteProperty(window, 'visualViewport'); };
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    if (this.dataset.testid === 'machine') return new DOMRect(0, machineTop, 900, 700);
    if (this.dataset.testid === 'viewport') return new DOMRect(0, 0, viewportBounds.width, viewportBounds.height);
    return new DOMRect();
  });
});
afterEach(() => { cleanup(); restoreViewport(); vi.unstubAllGlobals(); });

describe('Player viewport — mocked layout/browser boundaries, not real-rendering E2E', () => {
  it('subtracts the machine offset and window gutter while measuring the actual canvas area separately', () => {
    render(<Harness/>);
    expect(measurements()).toEqual({ height: 688, size: { width: 640, height: 400 } });
    expect(observers).toHaveLength(1);
    expect(observers[0].observe.mock.calls.map(([target]) => target)).toEqual([screen.getByTestId('machine'), screen.getByTestId('viewport')]);
  });

  it('uses full visual viewport height in fullscreen/theater even if the original machine was offscreen', () => {
    const view = render(<Harness/>);
    machineTop = 1200; viewportBounds = { width: 1050, height: 610 };
    view.rerender(<Harness expanded/>);
    expect(measurements()).toEqual({ height: 800, size: { width: 1050, height: 610 } });
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(observers).toHaveLength(2);
  });

  it('remeasures after error/notices or touch/learning-controls change the revision and machine position', () => {
    const view = render(<Harness revision="no-error:no-touch"/>);
    machineTop = 250; viewportBounds = { width: 640, height: 245 };
    view.rerender(<Harness revision="error-banner:touch:learning"/>);
    expect(measurements()).toEqual({ height: 538, size: { width: 640, height: 245 } });
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    machineTop = 1200; viewportBounds = { width: 400, height: 0 };
    view.rerender(<Harness revision="offscreen-error-banner"/>);
    const offscreen = measurements();
    expect(Number.isFinite(offscreen.height)).toBe(true); expect(offscreen.height).toBeGreaterThan(0);
    expect(offscreen.size).toEqual({ width: 400, height: 0 });
  });

  it('responds to visual viewport, browser resize and observed toolbar/control size changes', () => {
    render(<Harness/>);
    visual.height = 640;
    act(() => { visual.dispatchEvent(new Event('resize')); });
    expect(measurements().height).toBe(527);
    machineTop = 80; viewportBounds = { width: 480, height: 270 };
    fireEvent(window, new Event('resize'));
    expect(measurements()).toEqual({ height: 548, size: { width: 480, height: 270 } });
    viewportBounds = { width: 480, height: 190 };
    act(() => observers[0].notify());
    expect(measurements().size).toEqual({ width: 480, height: 190 });
  });

  it('falls back to innerHeight without visualViewport or ResizeObserver and remains finite when scrolled', () => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
    vi.stubGlobal('ResizeObserver', undefined);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(700);
    machineTop = -50;
    render(<Harness/>);
    expect(measurements().height).toBe(688); expect(observers).toHaveLength(0);
    machineTop = 2000;
    fireEvent(window, new Event('resize'));
    expect(measurements().height).toBeGreaterThan(0); expect(Number.isFinite(measurements().height)).toBe(true);
  });

  it('disconnects observers and removes the exact window/visual viewport listeners on unmount', () => {
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const removeVisual = vi.spyOn(visual, 'removeEventListener');
    const addWindow = vi.spyOn(window, 'addEventListener');
    const addVisual = vi.spyOn(visual, 'addEventListener');
    const view = render(<Harness/>);
    const windowResize = addWindow.mock.calls.find(([type]) => type === 'resize')![1];
    const visualResize = addVisual.mock.calls.find(([type]) => type === 'resize')![1];
    view.unmount();
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(removeWindow).toHaveBeenCalledWith('resize', windowResize);
    expect(removeVisual).toHaveBeenCalledWith('resize', visualResize);
  });
});
