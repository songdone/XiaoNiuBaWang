import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputController } from '../src/input/controller';
import { usePhysicalInputs } from '../src/input/usePhysicalInputs';
import { DEFAULT_MAPPINGS } from '../src/input/mappings';
import type { EmulatorAdapter } from '../src/emulator/adapter';
import { HoldButton, TouchControls } from '../src/input/TouchControls';

afterEach(cleanup);
function setup(learning = false) {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const adapter = { setButton: vi.fn(), setKeyboardKey: vi.fn() } as unknown as EmulatorAdapter;
  const input = new InputController(); input.attach(adapter);
  const mappings = { 1: { ...DEFAULT_MAPPINGS[1], a: 'KeyJ' }, 2: { ...DEFAULT_MAPPINGS[2] } };
  renderHook(() => usePhysicalInputs(input, true, learning, mappings));
  return { input, adapter };
}
describe('physical keyboard bindings', () => {
  it('uses custom player-one mapping and real player-two keys', () => {
    const { adapter } = setup();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', cancelable: true }));
    expect(adapter.setButton).toHaveBeenLastCalledWith(1, 'a', true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', cancelable: true }));
    expect(adapter.setButton).toHaveBeenLastCalledWith(2, 'up', true);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w' }));
    expect(adapter.setButton).toHaveBeenLastCalledWith(2, 'up', false);
  });
  it('does not block browser Ctrl/Alt shortcuts or type into form fields', () => {
    const { adapter } = setup();
    const ctrl = new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', ctrlKey: true, cancelable: true });
    window.dispatchEvent(ctrl); expect(ctrl.defaultPrevented).toBe(false);
    const field = document.createElement('input'); document.body.append(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', bubbles: true, cancelable: true }));
    field.remove(); expect(adapter.setButton).not.toHaveBeenCalled();
  });
  it('forwards learning keyboard Ctrl events without preventing browser shortcuts', () => {
    const { adapter } = setup(true);
    const event = new KeyboardEvent('keydown', { code: 'ControlLeft', key: 'Control', ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(adapter.setKeyboardKey).toHaveBeenCalledWith(expect.objectContaining({ code: 'ControlLeft', pressed: true, ctrlKey: true }));
    window.dispatchEvent(new Event('blur'));
    expect(adapter.setKeyboardKey).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'ControlLeft', pressed: false }));
  });
});

function scopedSetup(learning = false) {
  const root = document.createElement('main');
  const canvas = document.createElement('canvas'); canvas.tabIndex = 0;
  const surface = document.createElement('div'); surface.dataset.gameFocus = ''; surface.tabIndex = 0;
  const control = document.createElement('button'); control.dataset.inputControl = '';
  const toolbar = document.createElement('button');
  root.append(canvas, surface, control, toolbar); document.body.append(root);
  const scope: RefObject<HTMLElement | null> = { current: root };
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const adapter = { setButton: vi.fn(), setKeyboardKey: vi.fn() } as unknown as EmulatorAdapter;
  const input = new InputController(); input.attach(adapter);
  const hook = renderHook(({ enabled, mode }) => usePhysicalInputs(input, enabled, mode, DEFAULT_MAPPINGS, scope), { initialProps: { enabled: true, mode: learning } });
  canvas.focus();
  return { root, canvas, surface, control, toolbar, scope, adapter, input, hook, dispose: () => { hook.unmount(); root.remove(); } };
}
function keyDown(target: EventTarget, code = 'KeyX', options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...options });
  act(() => { target.dispatchEvent(event); });
  return event;
}
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('scoped focus and release safety', () => {
  it('accepts focused canvas, marked surfaces and in-scope controls, never body', () => {
    const { canvas, surface, control, input, adapter, dispose } = scopedSetup();
    expect(keyDown(canvas).defaultPrevented).toBe(true); act(() => input.releaseAll());
    surface.focus(); expect(keyDown(surface).defaultPrevented).toBe(true); act(() => input.releaseAll());
    control.focus(); expect(keyDown(control).defaultPrevented).toBe(true); act(() => input.releaseAll());
    expect(keyDown(control, 'Enter').defaultPrevented).toBe(false);
    canvas.focus(); expect(keyDown(window).defaultPrevented).toBe(true); act(() => input.releaseAll()); canvas.blur();
    const count = vi.mocked(adapter.setButton).mock.calls.length;
    expect(keyDown(document.body).defaultPrevented).toBe(false); expect(keyDown(window).defaultPrevented).toBe(false);
    expect(adapter.setButton).toHaveBeenCalledTimes(count); dispose();
  });
  it.each(['button', 'a', 'input', 'select', 'textarea', 'contenteditable', 'contenteditable-empty', 'contenteditable-plaintext', 'dialog', 'role-dialog', 'toolbar', 'role-button'])('never captures from %s inside a marked game surface', (kind) => {
    const { surface, adapter, dispose } = scopedSetup();
    const element = document.createElement(['button', 'a', 'input', 'select', 'textarea', 'dialog'].includes(kind) ? kind : 'div'); element.tabIndex = 0;
    if (kind.startsWith('contenteditable')) element.setAttribute('contenteditable', kind === 'contenteditable' ? 'true' : kind === 'contenteditable-empty' ? '' : 'plaintext-only');
    if (kind === 'role-dialog') element.setAttribute('role', 'dialog');
    if (kind === 'role-button') element.setAttribute('role', 'button');
    if (kind === 'toolbar') element.setAttribute('role', 'toolbar');
    surface.append(element); element.focus();
    expect(keyDown(element).defaultPrevented).toBe(false); expect(adapter.setButton).not.toHaveBeenCalled(); dispose();
  });
  it('rejects game surfaces outside scope and unfocused game events', () => {
    const { canvas, toolbar, adapter, dispose } = scopedSetup();
    const outside = document.createElement('canvas'); outside.tabIndex = 0; document.body.append(outside);
    outside.focus(); expect(keyDown(outside).defaultPrevented).toBe(false);
    toolbar.focus(); expect(keyDown(canvas).defaultPrevented).toBe(false);
    expect(adapter.setButton).not.toHaveBeenCalled(); outside.remove(); dispose();
  });
  it('releases on focusout away, preserving a canvas-to-control transition', () => {
    const { canvas, control, toolbar, input, adapter, dispose } = scopedSetup();
    keyDown(canvas); act(() => control.focus()); expect(input.hasSource('physical:KeyX')).toBe(true);
    act(() => toolbar.focus()); expect(adapter.setButton).toHaveBeenLastCalledWith(1, 'a', false);
    act(() => canvas.focus()); expect(keyDown(canvas, 'KeyX', { repeat: true }).defaultPrevented).toBe(false);
    expect(input.hasSource('physical:KeyX')).toBe(false);
    keyDown(canvas); act(() => canvas.blur()); expect(input.hasSource('physical:KeyX')).toBe(false); dispose();
  });
  it.each(['blur', 'fullscreenchange', 'visibilitychange'])('forces release on %s and ignores orphan repeats', (name) => {
    const { canvas, input, adapter, dispose } = scopedSetup();
    keyDown(canvas); keyDown(canvas, 'KeyX', { repeat: true }); expect(adapter.setButton).toHaveBeenCalledTimes(1);
    if (name === 'visibilitychange') vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => { (name === 'blur' ? window : document).dispatchEvent(new Event(name)); });
    if (name === 'visibilitychange') vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    expect(input.hasSource('physical:KeyX')).toBe(false);
    expect(keyDown(canvas, 'KeyX', { repeat: true }).defaultPrevented).toBe(false);
    keyDown(canvas); expect(input.hasSource('physical:KeyX')).toBe(true); dispose();
  });
  it('always releases excluded-target keyup and mode/enable changes', () => {
    const { canvas, toolbar, input, hook, dispose } = scopedSetup();
    keyDown(canvas); fireEvent.keyUp(toolbar, { code: 'KeyX', ctrlKey: true, metaKey: true }); expect(input.hasSource('physical:KeyX')).toBe(false);
    keyDown(canvas); hook.rerender({ enabled: false, mode: false }); expect(input.hasSource('physical:KeyX')).toBe(false);
    hook.rerender({ enabled: true, mode: true }); expect(keyDown(canvas, 'KeyX', { repeat: true }).defaultPrevented).toBe(false);
    keyDown(canvas); expect(input.getSnapshot().keys.has('KeyX')).toBe(true);
    hook.rerender({ enabled: true, mode: false }); expect(input.getSnapshot().keys.size).toBe(0); dispose();
  });
  it('blocks all keyboard input behind any open native dialog', () => {
    const { canvas, input, adapter, dispose } = scopedSetup(); keyDown(canvas);
    const dialog = document.createElement('dialog'); dialog.open = true; document.body.append(dialog);
    expect(keyDown(canvas, 'ArrowUp').defaultPrevented).toBe(false); expect(input.getSnapshot().buttons.size).toBe(0);
    dialog.open = false; const count = vi.mocked(adapter.setButton).mock.calls.length;
    keyDown(canvas, 'KeyX', { repeat: true }); expect(adapter.setButton).toHaveBeenCalledTimes(count);
    keyDown(canvas); expect(input.hasSource('physical:KeyX')).toBe(true); dialog.remove(); dispose();
  });
  it('forwards learning modifiers without stealing shortcuts, excluding system-reserved keys', () => {
    const { canvas, input, adapter, dispose } = scopedSetup(true);
    for (const [code, options] of [['ShiftLeft', { shiftKey: true }], ['ControlLeft', { ctrlKey: true }], ['AltLeft', { altKey: true }], ['KeyA', { ctrlKey: true }]] as const) {
      expect(keyDown(canvas, code, options).defaultPrevented).toBe(false); expect(input.hasSource(`physical:${code}`)).toBe(true);
    }
    act(() => input.releaseAll()); vi.mocked(adapter.setKeyboardKey!).mockClear();
    for (const [code, options] of [['Tab', {}], ['MetaLeft', { metaKey: true }], ['KeyA', { metaKey: true }], ['Delete', { ctrlKey: true, altKey: true }]] as const) expect(keyDown(canvas, code, options).defaultPrevented).toBe(false);
    expect(adapter.setKeyboardKey).not.toHaveBeenCalled(); dispose();
  });
});

function gamepad(index = 0, mapping = 'standard', button = 0, axes = [0, 0]) {
  return { index, id: `Test pad ${index}`, connected: true, mapping, axes, timestamp: 0, vibrationActuator: null, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === button, value: i === button ? 1 : 0, touched: false })) } as unknown as Gamepad;
}
function setupPads(scoped = true) {
  const fixture = scopedSetup(); fixture.hook.unmount();
  let frame: FrameRequestCallback = () => {};
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1; });
  const hook = renderHook(({ enabled }) => usePhysicalInputs(fixture.input, enabled, false, DEFAULT_MAPPINGS, scoped ? fixture.scope : undefined), { initialProps: { enabled: true } });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  let pads: (Gamepad | null)[] = [gamepad()];
  vi.stubGlobal('navigator', { getGamepads: vi.fn(() => pads) });
  return { ...fixture, hook, tick: () => act(() => frame(0)), setPads: (next: (Gamepad | null)[]) => { pads = next; }, dispose: () => { hook.unmount(); fixture.root.remove(); } };
}
describe('gamepad focus safety', () => {
  it.each([true, false])('blocks native dialogs while focus remains canvas (scoped=%s)', (scoped) => {
    const { input, tick, dispose } = setupPads(scoped); tick(); expect(input.getSnapshot().buttons.has('1:a')).toBe(true);
    const dialog = document.createElement('dialog'); dialog.open = true; document.body.append(dialog);
    tick(); expect(input.getSnapshot().buttons.size).toBe(0);
    dialog.open = false; tick(); expect(input.getSnapshot().buttons.has('1:a')).toBe(true); dialog.remove(); dispose();
  });
  it('releases on toolbar/body focus, background, disabled and unavailable focus', () => {
    const { canvas, toolbar, input, tick, hook, dispose } = setupPads(); tick(); expect(input.getSnapshot().buttons.size).toBe(1);
    act(() => toolbar.focus()); tick(); expect(input.getSnapshot().buttons.size).toBe(0);
    act(() => canvas.focus()); tick(); expect(input.getSnapshot().buttons.size).toBe(1);
    act(() => canvas.blur()); tick(); expect(input.getSnapshot().buttons.size).toBe(0);
    act(() => canvas.focus()); tick(); vi.spyOn(document, 'hasFocus').mockReturnValue(false); tick(); expect(input.getSnapshot().buttons.size).toBe(0);
    vi.spyOn(document, 'hasFocus').mockReturnValue(true); tick(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); tick(); expect(input.getSnapshot().buttons.size).toBe(0);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); tick(); hook.rerender({ enabled: false }); tick(); expect(input.getSnapshot().buttons.size).toBe(0); dispose();
  });
  it('preserves physical co-holds on high-index disconnect and rejects nonstandard pads', () => {
    const { canvas, input, tick, setPads, dispose } = setupPads();
    setPads([gamepad(20)]); tick(); keyDown(canvas); setPads([]); tick();
    expect(input.hasSource('gamepad:20:a')).toBe(false); expect(input.getSnapshot().buttons.has('1:a')).toBe(true);
    act(() => input.releaseSource('physical:KeyX'));
    setPads([gamepad(0, 'nonstandard'), gamepad(1, 'standard', 15, [-0.8, -0.8])]); tick();
    expect(input.getSnapshot().buttons.has('1:a')).toBe(false); expect([...input.getSnapshot().buttons]).toEqual(['2:up', '2:left', '2:right']); dispose();
  });
  it('tolerates blocked gamepad access and releases previously polled sources', () => {
    const { input, tick, dispose } = setupPads(); tick();
    vi.mocked(navigator.getGamepads).mockImplementation(() => { throw new DOMException('Not allowed'); });
    tick(); expect(input.getSnapshot().buttons.size).toBe(0); dispose();
  });
});

function pointer(target: Window | Document | Element, name: string, pointerId: number, button = 0) {
  const event = new Event(name, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerId: { value: pointerId }, button: { value: button } }); fireEvent(target, event);
}
function touchSetup() {
  const adapter = { setButton: vi.fn(), setKeyboardKey: vi.fn() } as unknown as EmulatorAdapter;
  const input = new InputController(); input.attach(adapter);
  const view = render(<TouchControls input={input} enabled/>);
  return { input, adapter, view, a: screen.getByRole('button', { name: 'A 按键' }), b: screen.getByRole('button', { name: 'B 按键' }) };
}
describe('HoldButton source-aware safety', () => {
  it('holds multiple pointers and physical/gamepad sources independently', () => {
    const { a, b, input, adapter } = touchSetup();
    act(() => { input.setButton('physical:KeyX', 1, 'a', true); input.setButton('gamepad:0:a', 1, 'a', true); });
    pointer(a, 'pointerdown', 1); pointer(a, 'pointerdown', 2); pointer(b, 'pointerdown', 3);
    pointer(a, 'pointerup', 1); expect(input.hasSource('pointer:2')).toBe(true);
    pointer(a, 'pointercancel', 2); expect(input.getSnapshot().buttons.has('1:a')).toBe(true); expect(adapter.setButton).not.toHaveBeenCalledWith(1, 'a', false);
    pointer(b, 'lostpointercapture', 3); expect(input.getSnapshot().buttons.has('1:b')).toBe(false);
    act(() => input.releasePrefix('gamepad:')); expect(input.getSnapshot().buttons.has('1:a')).toBe(true);
    act(() => input.releaseSource('physical:KeyX')); expect(input.getSnapshot().buttons.size).toBe(0);
  });
  it('clears local bookkeeping on global and source-only release even with active co-holds', () => {
    const { a, input, adapter } = touchSetup(); pointer(a, 'pointerdown', 4);
    act(() => input.setButton('physical:KeyX', 1, 'a', true)); act(() => input.releaseSource('pointer:4'));
    expect(input.getSnapshot().buttons.has('1:a')).toBe(true);
    pointer(a, 'pointerdown', 4); expect(input.hasSource('pointer:4')).toBe(true); act(() => input.releaseAll());
    pointer(a, 'pointerdown', 4); expect(input.hasSource('pointer:4')).toBe(true);
    pointer(a, 'pointerup', 4); expect(adapter.setButton).toHaveBeenLastCalledWith(1, 'a', false);
  });
  it('releases capture, tolerates capture errors and releases outside pointer endings', () => {
    const { a, input } = touchSetup(); const captures = new Set<number>();
    Object.assign(a, { setPointerCapture: vi.fn((id: number) => captures.add(id)), hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: vi.fn((id: number) => captures.delete(id)) });
    pointer(a, 'pointerdown', 8); expect(document.activeElement).toBe(a);
    act(() => input.releaseAll()); expect(a.releasePointerCapture).toHaveBeenCalledWith(8);
    vi.mocked(a.setPointerCapture).mockImplementation(() => { throw new DOMException('Capture failed'); });
    pointer(a, 'pointerdown', 9); pointer(window, 'pointerup', 9); expect(input.getSnapshot().buttons.size).toBe(0);
    pointer(a, 'pointerdown', 10); pointer(window, 'pointercancel', 10); expect(input.getSnapshot().buttons.size).toBe(0);
  });
  it('releases disabled/unmounted controls and accepts fresh press after re-enable', () => {
    const { a, input, view, adapter } = touchSetup(); pointer(a, 'pointerdown', 1); pointer(a, 'pointerdown', 2);
    view.rerender(<TouchControls input={input} enabled={false}/>); expect(input.getSnapshot().buttons.size).toBe(0);
    const count = vi.mocked(adapter.setButton).mock.calls.length;
    pointer(a, 'pointerdown', 1); keyDown(a, 'Space'); expect(adapter.setButton).toHaveBeenCalledTimes(count);
    view.rerender(<TouchControls input={input} enabled/>); pointer(a, 'pointerdown', 1); expect(input.hasSource('pointer:1')).toBe(true);
    view.unmount(); expect(input.getSnapshot().buttons.size).toBe(0);
  });
  it.each(['blur', 'fullscreenchange', 'visibilitychange'])('releases pointer/accessibility holds on global %s', (name) => {
    const { a, input } = touchSetup(); pointer(a, 'pointerdown', 1); keyDown(a, 'Space');
    if (name === 'visibilitychange') vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(name === 'blur' ? window : document, new Event(name)); expect(input.getSnapshot().buttons.size).toBe(0);
  });
  it('button blur releases only accessibility, retaining a pointer and rejecting orphan repeats', () => {
    const { a, b, input } = touchSetup(); pointer(a, 'pointerdown', 1); keyDown(a, 'Space'); fireEvent.blur(a, { relatedTarget: b });
    expect(input.hasSource('accessible:A 按键:Space')).toBe(false); expect(input.hasSource('pointer:1')).toBe(true);
    expect(keyDown(a, 'Space', { repeat: true }).defaultPrevented).toBe(false);
    keyDown(a, 'Space'); expect(input.hasSource('accessible:A 按键:Space')).toBe(true); act(() => input.releaseAll());
    keyDown(a, 'Space', { repeat: true }); expect(input.getSnapshot().buttons.size).toBe(0);
  });
  it('does not double-map Enter/Space but forwards other physical keys from focused touch controls', () => {
    const { root, input, dispose } = scopedSetup(); render(<TouchControls input={input} enabled/>, { container: root });
    const a = screen.getByRole('button', { name: 'A 按键' }); act(() => a.focus());
    keyDown(a, 'Enter'); expect(input.getSnapshot().buttons.has('1:a')).toBe(true); expect(input.getSnapshot().buttons.has('1:start')).toBe(false);
    fireEvent.keyUp(a, { code: 'Enter' }); keyDown(a, 'ArrowUp'); expect(input.hasSource('physical:ArrowUp')).toBe(true); dispose();
  });
  it('rejects secondary pointer buttons and modified accessibility shortcuts', () => {
    const { a, input } = touchSetup(); pointer(a, 'pointerdown', 3, 2);
    expect(keyDown(a, 'Space', { ctrlKey: true }).defaultPrevented).toBe(false); expect(keyDown(a, 'Enter', { metaKey: true }).defaultPrevented).toBe(false);
    expect(input.getSnapshot().buttons.size).toBe(0);
  });
  it('never presses behind an open native dialog or within role dialogs', () => {
    const { a, input } = touchSetup(); const dialog = document.createElement('dialog'); dialog.open = true; document.body.append(dialog);
    pointer(a, 'pointerdown', 1); expect(keyDown(a, 'Enter').defaultPrevented).toBe(false); expect(input.getSnapshot().buttons.size).toBe(0); dialog.remove();
    render(<div role="dialog"><HoldButton input={input} label="dialog key" onPress={(source) => input.setButton(source, 1, 'a', true)} onRelease={input.releaseSource.bind(input)}>key</HoldButton></div>);
    const control = screen.getByRole('button', { name: 'dialog key' }); pointer(control, 'pointerdown', 2); keyDown(control, 'Space'); expect(input.getSnapshot().buttons.size).toBe(0);
  });
});
