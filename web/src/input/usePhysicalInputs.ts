import { useEffect, useState, type RefObject } from 'react';
import type { ControllerButton, PlayerNumber } from '../emulator/adapter';
import type { InputController } from './controller';
import { DEFAULT_MAPPINGS, type InputMappings } from './mappings';

const NON_GAME_TARGETS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog, [role="dialog"], [role="toolbar"]';

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

export function usePhysicalInputs(input: InputController, enabled: boolean, learning: boolean, mappings: InputMappings = DEFAULT_MAPPINGS, scope?: RefObject<HTMLElement | null>) {
  const [gamepads, setGamepads] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target === window || event.target instanceof Window || event.target === document ? document.activeElement : event.target;
      if (dialogOpen()) { input.releaseAll(); return; }
      if (!acceptsInput(target, scope) || (scope && !acceptsInput(document.activeElement, scope))) return;
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
              input.setButton(source, player, button as ControllerButton, true);
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
  }, [input, enabled, learning, mappings, scope]);

  useEffect(() => {
    let frame = 0;
    let lastNames = '';
    let lastIndexes = new Set<number>();
    const poll = () => {
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
        if (!enabled || document.hidden || !document.hasFocus() || dialogOpen() || !acceptsInput(document.activeElement, scope) || pad.mapping !== 'standard') {
          input.releasePrefix(`gamepad:${pad.index}:`);
          return;
        }
        const player = (position + 1) as PlayerNumber;
        const held = (index: number) => !!pad.buttons[index]?.pressed;
        const states: Record<ControllerButton, boolean> = {
          a: held(0) || held(2), b: held(1) || held(3),
          select: held(8), start: held(9),
          up: held(12) || (pad.axes[1] ?? 0) < -0.45,
          down: held(13) || (pad.axes[1] ?? 0) > 0.45,
          left: held(14) || (pad.axes[0] ?? 0) < -0.45,
          right: held(15) || (pad.axes[0] ?? 0) > 0.45,
        };
        for (const [button, pressed] of Object.entries(states)) {
          input.setButton(`gamepad:${pad.index}:${button}`, player, button as ControllerButton, pressed);
        }
      });
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => { cancelAnimationFrame(frame); input.releasePrefix('gamepad:'); };
  }, [input, enabled, scope]);
  return gamepads;
}
