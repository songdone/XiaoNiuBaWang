import type { ControllerButton, PlayerNumber } from '../emulator/adapter';

export type MappableButton = ControllerButton | 'turboA' | 'turboB';
export const BASE_BUTTONS: ControllerButton[] = ['up', 'down', 'left', 'right', 'a', 'b', 'start', 'select'];
export const BUTTON_LABELS: Record<MappableButton, string> = {
  up: '上', down: '下', left: '左', right: '右',
  a: 'A', b: 'B', start: '开始', select: '选择',
  turboA: '连发 A', turboB: '连发 B',
};
export const BUTTONS = Object.keys(BUTTON_LABELS) as MappableButton[];
export type PlayerMappings = Record<ControllerButton, string> & Partial<Record<'turboA' | 'turboB', string>>;
export interface InputMappings { 1: PlayerMappings; 2: PlayerMappings }
export const DEFAULT_MAPPINGS: InputMappings = {
  1: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', a: 'KeyX', b: 'KeyZ', start: 'Enter', select: 'ShiftRight', turboA: 'KeyC', turboB: 'KeyV' },
  2: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', a: 'KeyH', b: 'KeyG', start: 'KeyU', select: 'KeyT', turboA: 'KeyY', turboB: 'KeyR' },
};

export interface KeyPreset {
  id: 'default' | 'wasd' | 'arcade';
  label: string;
  summary: string;
  mappings: InputMappings;
}

export const KEY_PRESETS: KeyPreset[] = [
  {
    id: 'default',
    label: '双人默认',
    summary: '1P 方向键 + X/Z · 2P WASD + H/G',
    mappings: DEFAULT_MAPPINGS,
  },
  {
    id: 'wasd',
    label: '经典 WASD + J/K',
    summary: '1P 左手 WASD + 右手 K(A)/J(B) + I/U 连发',
    mappings: {
      1: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', a: 'KeyK', b: 'KeyJ', start: 'Enter', select: 'ShiftRight', turboA: 'KeyI', turboB: 'KeyU' },
      2: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', a: 'Numpad2', b: 'Numpad1', start: 'NumpadEnter', select: 'Numpad0', turboA: 'Numpad5', turboB: 'Numpad4' },
    },
  },
  {
    id: 'arcade',
    label: '方向键 + J/K',
    summary: '1P 方向键 + K(A)/J(B) + I/U 连发',
    mappings: {
      1: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', a: 'KeyK', b: 'KeyJ', start: 'Enter', select: 'ShiftRight', turboA: 'KeyI', turboB: 'KeyU' },
      2: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', a: 'KeyH', b: 'KeyG', start: 'KeyO', select: 'KeyT', turboA: 'KeyY', turboB: 'KeyR' },
    },
  },
];
export function normalizeMappings(value: unknown): InputMappings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result = { 1: { ...DEFAULT_MAPPINGS[1] }, 2: { ...DEFAULT_MAPPINGS[2] } };
  for (const player of [1, 2] as PlayerNumber[]) {
    const map = raw[player] && typeof raw[player] === 'object' ? raw[player] as Record<string, unknown> : {};
    for (const button of BUTTONS) if (typeof map[button] === 'string' && /^[A-Za-z0-9]+$/.test(map[button])) result[player][button] = map[button];
  }
  return result;
}
export function keyLabel(code?: string): string {
  if (!code) return '未绑定';
  const labels: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftRight: '右 Shift', ShiftLeft: '左 Shift', Space: 'Space',
    ControlLeft: '左 Ctrl', ControlRight: '右 Ctrl', AltLeft: '左 Alt', AltRight: '右 Alt',
    NumpadEnter: '小键盘 Enter',
  };
  return labels[code] || code.replace(/^Key|^Digit/, '').replace(/^Numpad/, '小键盘 ');
}
