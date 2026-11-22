import type { ControllerButton, PlayerNumber } from '../emulator/adapter';

export const BUTTON_LABELS: Record<ControllerButton, string> = { up: '上', down: '下', left: '左', right: '右', a: 'A', b: 'B', start: '开始', select: '选择' };
export const BUTTONS = Object.keys(BUTTON_LABELS) as ControllerButton[];
export type PlayerMappings = Record<ControllerButton, string>;
export interface InputMappings { 1: PlayerMappings; 2: PlayerMappings }
export const DEFAULT_MAPPINGS: InputMappings = {
  1: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', a: 'KeyX', b: 'KeyZ', start: 'Enter', select: 'ShiftRight' },
  2: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', a: 'KeyH', b: 'KeyG', start: 'KeyU', select: 'KeyT' },
};
export function normalizeMappings(value: unknown): InputMappings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result = { 1: { ...DEFAULT_MAPPINGS[1] }, 2: { ...DEFAULT_MAPPINGS[2] } };
  for (const player of [1, 2] as PlayerNumber[]) {
    const map = raw[player] && typeof raw[player] === 'object' ? raw[player] as Record<string, unknown> : {};
    for (const button of BUTTONS) if (typeof map[button] === 'string' && /^[A-Za-z0-9]+$/.test(map[button])) result[player][button] = map[button];
  }
  return result;
}
export function keyLabel(code: string): string {
  const labels: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftRight: '右 Shift', ShiftLeft: '左 Shift', Space: 'Space', ControlLeft: '左 Ctrl', ControlRight: '右 Ctrl', AltLeft: '左 Alt', AltRight: '右 Alt' };
  return labels[code] || code.replace(/^Key|^Digit/, '');
}
