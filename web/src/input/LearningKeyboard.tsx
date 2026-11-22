import { useState, useSyncExternalStore } from 'react';
import type { InputController } from './controller';
import { HoldButton } from './TouchControls';
import { Icon } from '../components/Icon';

interface Key { code: string; label: string; key: string; shift?: string; width?: number }
const k = (code: string, label: string, key = label, shift?: string, width?: number): Key => ({ code, label, key, shift, width });
const rows: Key[][] = [
  [k('Escape', 'Esc', 'Escape'), ...Array.from({ length: 8 }, (_, index) => k(`F${index + 1}`, `F${index + 1}`)), k('Delete', 'Del', 'Delete')],
  [k('Backquote', '`', '`', '~'), ...'1234567890'.split('').map((n, index) => k(`Digit${n}`, n, n, '!@#$%^&*()'[index])), k('Minus', '−', '-', '_'), k('Equal', '=', '=', '+'), k('Backspace', '⌫', 'Backspace', undefined, 1.6)],
  [k('Tab', 'Tab', 'Tab', undefined, 1.3), ...'QWERTYUIOP'.split('').map((n) => k(`Key${n}`, n, n.toLowerCase(), n)), k('BracketLeft', '[', '[', '{'), k('BracketRight', ']', ']', '}'), k('Backslash', '\\', '\\', '|')],
  [k('CapsLock', 'Caps', 'CapsLock', undefined, 1.6), ...'ASDFGHJKL'.split('').map((n) => k(`Key${n}`, n, n.toLowerCase(), n)), k('Semicolon', ';', ';', ':'), k('Quote', "'", "'", '"'), k('Enter', 'Enter', 'Enter', undefined, 1.7)],
  [k('ShiftLeft', 'Shift', 'Shift', undefined, 2.1), ...'ZXCVBNM'.split('').map((n) => k(`Key${n}`, n, n.toLowerCase(), n)), k('Comma', ',', ',', '<'), k('Period', '.', '.', '>'), k('Slash', '/', '/', '?'), k('ShiftRight', 'Shift', 'Shift', undefined, 2.1)],
  [k('ControlLeft', 'Ctrl', 'Control', undefined, 1.3), k('AltLeft', 'Alt', 'Alt', undefined, 1.3), k('Space', 'Space', ' ', undefined, 6), k('ArrowLeft', '←', 'ArrowLeft'), k('ArrowUp', '↑', 'ArrowUp'), k('ArrowDown', '↓', 'ArrowDown'), k('ArrowRight', '→', 'ArrowRight')],
];

const keyChinese: Record<string, string> = { Escape: '退出', Delete: '删除', Backspace: '退格', Tab: '制表', CapsLock: '大写', Enter: '回车', ShiftLeft: '上档', ShiftRight: '上档', ControlLeft: '控制', AltLeft: '换挡', Space: '空格' };

export function LearningKeyboard({ input, enabled, expanded, onToggle }: {
  input: InputController; enabled: boolean; expanded: boolean; onToggle: () => void;
}) {
  const snapshot = useSyncExternalStore(input.subscribe, input.getSnapshot);
  const [caps, setCaps] = useState(false);
  return <section className="learning-panel"><button className="learning-heading" aria-expanded={expanded} aria-controls="learning-keys" onClick={onToggle}><span><Icon name="keyboard"/><strong>学习键盘</strong><span className="tag subtle">{enabled ? '已连接' : '未启用'}</span></span><span>{expanded ? '收起' : '展开'}<Icon name="chevron" size={16} className={expanded ? 'rotate-up' : 'rotate-down'}/></span></button>
    {expanded && <div id="learning-keys"><p className="keyboard-explanation">选择“任天堂家庭电脑键盘”或“小霸王学习键盘”后使用。实体键盘与屏幕按键会发送真实按下、松开事件；也可同时按住上档键与字母。小屏幕可横向滚动下方键盘。</p><div className="learning-keyboard-viewport" tabIndex={0} role="region" aria-label="可横向滚动的学习机键盘"><div className="learning-keyboard" aria-label="学习机完整键盘">{rows.map((row, index) => <div className="learning-key-row" key={index}>{row.map((key) => <HoldButton input={input} key={key.code} label={`学习键 ${keyChinese[key.code] || key.label}`} className="learning-key" active={snapshot.keys.has(key.code)} disabled={!enabled} style={{ flex: key.width || 1 }} onPress={(source) => {
      const shift = snapshot.keys.has('ShiftLeft') || snapshot.keys.has('ShiftRight');
      if (key.code === 'CapsLock') setCaps((current) => !current);
      input.setKey(source, { code: key.code, key: shift ? key.shift || key.key : caps && key.code.startsWith('Key') ? key.key.toUpperCase() : key.key, pressed: true, shiftKey: shift, ctrlKey: snapshot.keys.has('ControlLeft'), altKey: snapshot.keys.has('AltLeft'), capsLock: caps });
    }} onRelease={(source) => input.releaseSource(source)}><><span>{key.label}</span>{keyChinese[key.code] && <small>{keyChinese[key.code]}</small>}</></HoldButton>)}</div>)}</div></div>{!enabled && <p className="keyboard-disabled-note">请先运行卡带，并在上方选择学习键盘设备。</p>}</div>}
  </section>;
}
