import { useEffect, useState, type RefObject } from 'react';
import type { ControllerButton, PlayerNumber } from '../emulator/adapter';
import type { InputController } from './controller';
import { DEFAULT_MAPPINGS, type InputMappings } from './mappings';

const NON_GAME_TARGETS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog, [role="dialog"], [role="toolbar"]';

function isIdlePageFocus(target: EventTarget | null) {
  if (!target || target === window || target instanceof Window || target === document) return true;
  if (!(target instanceof Element)) return true;
  if (target === document.body || target === document.documentElement || target.id === 'main-content') return true;
  if (target.closest(NON_GAME_TARGETS)) return false;
  if (target.closest('button, a, [role="button"]')) return false;
  return false;
}

function matchesMappedKey(code: string, mappings: InputMappings) {
  for (const player of [1, 2] as PlayerNumber[]) {
    for (const mapped of Object.values(mappings[player])) {
      if (mapped === code) return true;
    }
  }
  return false;
}

function acceptsInput(target: EventTarget | null, scope?: RefObject<HTMLElement | null>) {
  if (!(target instanceof Element)) return !scope;
  if (target.closest(NON_GAME_TARGETS)) return false;
  // HoldButton handles its own Enter/Space; other mapped keys may still be used here.
  const nativeControl = target.closest('button, a, [role="button"]');
  if (nativeControl && !nativeControl.matches('[data-input-control]:not(a)')) return false;
  if (!scope) return true;
  const root = scope.current;
  const surface = target.closest('canvas, [data-game-focus], [data-input-control]');
  return !!root && root.contains(target) && !!surface && root.contains(surface);
}

function dialogOpen() {
  return !!document.querySelector('dialog[open]');
}

export function usePhysicalInputs(
  input: InputController,
  enabled: boolean,
  learning: boolean,
  mappings: InputMappings = DEFAULT_MAPPINGS,
  scope?: RefObject<HTMLElement | null>,
  fallbackFocus?: RefObject<HTMLElement | null>,
) {
  const [gamepads, setGamepads] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target === window || event.target instanceof Window || event.target === document ? document.activeElement : event.target;
      if (dialogOpen()) { input.releaseAll(); return; }
      let accepted = acceptsInput(target, scope) && (!scope || acceptsInput(document.activeElement, scope));
      if (
        !accepted
        && !learning
        && fallbackFocus?.current
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
        && isIdlePageFocus(target)
        && isIdlePageFocus(document.activeElement)
        && matchesMappedKey(event.code, mappings)
        && (!scope?.current || scope.current.contains(fallbackFocus.current))
      ) {
        fallbackFocus.current.focus({ preventScroll: true });
        accepted = true;
      }
      if (!accepted) return;
      if (target instanceof Element && target.closest('[data-input-control]') && ['Enter', 'Space'].includes(event.code)) return;
      if (event.metaKey || event.code.startsWith('Meta') || event.code === 'Tab' || (event.ctrlKey && event.altKey && event.code === 'Delete')) return;
      if (!learning && (event.ctrlKey || event.altKey)) return;
      const source = `physical:${event.code}`;
      // A key still physically down after pause/blur must not undo a forced release.
      if (event.repeat && !input.hasSource(source)) return;
      if (learning) {
        if (!event.ctrlKey && !event.altKey && !/^(Shift|Control|Alt)/.test(event.code) && event.code !== 'Escape') event.preventDefault();
        input.setKey(source, {
          code: event.code, key: event.key, pressed: true,
          shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey,
          capsLock: event.getModifierState('CapsLock'),
        });
      } else {
        for (const player of [1, 2] as PlayerNumber[]) {
          for (const [button, code] of Object.entries(mappings[player])) {
            if (code === event.code) {
              event.preventDefault();
              if (button === 'turboA') input.setTurbo(source, player, 'a', true);
              else if (button === 'turboB') input.setTurbo(source, player, 'b', true);
              else input.setButton(source, player, button as ControllerButton, true);
            }
          }
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => input.releaseSource(`physical:${event.code}`);
    const release = () => input.releaseAll();
    const onVisibility = () => { if (document.hidden) release(); };
    const onFocusOut = (event: FocusEvent) => { if (!event.relatedTarget || !acceptsInput(event.relatedTarget, scope)) release(); };
    const onFocusIn = (event: FocusEvent) => { if (dialogOpen() || !acceptsInput(event.target, scope)) release(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('fullscreenchange', release);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('fullscreenchange', release);
      input.releasePrefix('physical:');
    };
  }, [input, enabled, learning, mappings, scope, fallbackFocus]);

  useEffect(() => {
    let frame = 0;
    let active = true;
    let lastNames = '';
    let lastIndexes = new Set<number>();
    const schedule = () => {
      if (!active || frame !== 0) return;
      frame = requestAnimationFrame(poll);
    };
    const poll = () => {
      frame = 0;
      if (!active) return;
      let pads: (Gamepad | null)[] = [];
      try { pads = typeof navigator.getGamepads === 'function' ? [...navigator.getGamepads()] : []; }
      catch { /* Browser may disallow gamepad access outside a secure context. */ }
      const connected = pads.filter((pad): pad is Gamepad => !!pad?.connected);
      const names = connected.map((pad) => pad.mapping === 'standard' ? pad.id : `${pad.id}（非标准手柄，暂不支持）`);
      const signature = names.join('|');
      if (signature !== lastNames) { lastNames = signature; setGamepads(names); }
      const activeIndexes = new Set(connected.slice(0, 2).map((pad) => pad.index));
      for (const index of lastIndexes) {
        if (!activeIndexes.has(index)) input.releasePrefix(`gamepad:${index}:`);
      }
      lastIndexes = activeIndexes;
      connected.slice(0, 2).forEach((pad, position) => {
        const focusAllowed = acceptsInput(document.activeElement, scope)
          || (!!fallbackFocus?.current && isIdlePageFocus(document.activeElement) && (!scope?.current || scope.current.contains(fallbackFocus.current)));
        if (!enabled || document.hidden || !document.hasFocus() || dialogOpen() || !focusAllowed || pad.mapping !== 'standard') {
          input.releasePrefix(`gamepad:${pad.index}:`);
          return;
        }
        const player = (position + 1) as PlayerNumber;
        const held = (index: number) => !!pad.buttons[index]?.pressed;
        const states: Record<ControllerButton, boolean> = {
          a: held(0), b: held(1),
          select: held(8), start: held(9),
          up: held(12) || (pad.axes[1] ?? 0) < -0.45,
          down: held(13) || (pad.axes[1] ?? 0) > 0.45,
          left: held(14) || (pad.axes[0] ?? 0) < -0.45,
          right: held(15) || (pad.axes[0] ?? 0) > 0.45,
        };
        for (const [button, pressed] of Object.entries(states)) {
          input.setButton(`gamepad:${pad.index}:${button}`, player, button as ControllerButton, pressed);
        }
        // Standard gamepad X(2)/RB(5) -> Turbo A, Y(3)/LB(4) -> Turbo B for classic shooters.
        input.setTurbo(`gamepad:${pad.index}:turboA`, player, 'a', held(2) || held(5));
        input.setTurbo(`gamepad:${pad.index}:turboB`, player, 'b', held(3) || held(4));
      });
      // Avoid idle 60/120 Hz rAF wakeups when no gamepad is connected; wake on gamepadconnected.
      if (connected.length > 0 && enabled) schedule();
    };
    const onConnected = () => schedule();
    const onDisconnected = () => schedule();
    window.addEventListener('gamepadconnected', onConnected);
    window.addEventListener('gamepaddisconnected', onDisconnected);
    schedule();
    return () => {
      active = false;
      window.removeEventListener('gamepadconnected', onConnected);
      window.removeEventListener('gamepaddisconnected', onDisconnected);
      if (frame !== 0) cancelAnimationFrame(frame);
      input.releasePrefix('gamepad:');
    };
  }, [input, enabled, scope, fallbackFocus]);
  return gamepads;
}
