import { describe, expect, it, vi } from 'vitest';
import { InputController } from '../src/input/controller';
import type { EmulatorAdapter, LearningKeyEvent } from '../src/emulator/adapter';

function fixture() {
  const adapter = { setButton: vi.fn(), setKeyboardKey: vi.fn() } as unknown as EmulatorAdapter;
  const input = new InputController(); input.attach(adapter);
  return { input, adapter };
}
const key: LearningKeyEvent = { code: 'KeyA', key: 'a', pressed: true, shiftKey: false, ctrlKey: false, altKey: false, capsLock: false };
describe('source-aware controller', () => {
  it('keeps a held button down until every source releases', () => {
    const { input, adapter } = fixture();
    input.setButton('physical:KeyX', 1, 'a', true);
    input.setButton('pointer:2', 1, 'a', true);
    input.releaseSource('pointer:2');
    expect(adapter.setButton).toHaveBeenCalledTimes(1);
    expect(input.getSnapshot().buttons.has('1:a')).toBe(true);
    input.releaseSource('physical:KeyX');
    expect(adapter.setButton).toHaveBeenLastCalledWith(1, 'a', false);
  });
  it('holds independent pointers, players and diagonal buttons', () => {
    const { input, adapter } = fixture();
    input.setButton('pointer:1', 1, 'up', true); input.setButton('pointer:2', 1, 'right', true);
    input.setButton('gamepad:0:a', 2, 'a', true); input.releaseSource('pointer:1');
    expect([...input.getSnapshot().buttons]).toEqual(['1:right', '2:a']);
    input.releaseAll();
    expect(input.getSnapshot().buttons.size).toBe(0);
    expect(adapter.setButton).toHaveBeenLastCalledWith(2, 'a', false);
  });
  it('releases only disconnected gamepad sources and sends learning keyup', () => {
    const { input, adapter } = fixture();
    input.setButton('gamepad:0:a', 1, 'a', true); input.setButton('physical:KeyX', 1, 'a', true);
    input.releasePrefix('gamepad:0:');
    expect(input.getSnapshot().buttons.has('1:a')).toBe(true);
    input.setKey('physical:KeyA', key); input.setKey('pointer:7', key); input.releaseSource('pointer:7');
    expect(adapter.setKeyboardKey).toHaveBeenCalledTimes(1);
    input.releaseAll();
    expect(adapter.setKeyboardKey).toHaveBeenLastCalledWith({ ...key, pressed: false });
  });
  it('reports actual released sources even when another source keeps the same button active', () => {
    const { input, adapter } = fixture();
    const release = vi.fn(); const unsubscribe = input.subscribeRelease(release);
    input.setButton('pointer:1', 1, 'a', true); input.setButton('physical:KeyX', 1, 'a', true);
    input.setKey('pointer:1', key);
    expect(input.hasSource('pointer:1')).toBe(true);
    input.releaseSource('pointer:1');
    expect(release).toHaveBeenCalledTimes(1); expect(release).toHaveBeenLastCalledWith(new Set(['pointer:1']));
    expect(input.hasSource('pointer:1')).toBe(false); expect(input.getSnapshot().buttons.has('1:a')).toBe(true);
    expect(adapter.setButton).not.toHaveBeenCalledWith(1, 'a', false);
    input.releaseSource('pointer:1'); input.releasePrefix('missing:'); expect(release).toHaveBeenCalledTimes(1);
    unsubscribe(); input.releaseAll(); expect(release).toHaveBeenCalledTimes(1);
  });
  it('global release notifies once with unique button/key sources and skips idle publication', () => {
    const { input, adapter } = fixture();
    const release = vi.fn(); const update = vi.fn(); input.subscribeRelease(release); input.subscribe(update);
    const idleSnapshot = input.getSnapshot(); input.releaseAll();
    expect(release).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); expect(input.getSnapshot()).toBe(idleSnapshot);
    input.setButton('pointer:1', 1, 'a', true); input.setButton('pointer:1', 2, 'b', true);
    input.setKey('pointer:1', key); input.setKey('physical:KeyA', key);
    update.mockClear(); input.releaseAll();
    expect(release).toHaveBeenCalledTimes(1); expect(release).toHaveBeenLastCalledWith(new Set(['pointer:1', 'physical:KeyA']));
    expect(update).toHaveBeenCalledTimes(1); expect(adapter.setKeyboardKey).toHaveBeenLastCalledWith({ ...key, pressed: false });
    const releasedSnapshot = input.getSnapshot(); input.releaseAll();
    expect(release).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1); expect(input.getSnapshot()).toBe(releasedSnapshot);
  });
  it('prefix release reports only matched sources and attach releases old adapter without replay', () => {
    const { input, adapter } = fixture(); const release = vi.fn(); input.subscribeRelease(release);
    input.setButton('gamepad:20:a', 1, 'a', true); input.setButton('pointer:2', 1, 'a', true);
    input.releasePrefix('gamepad:20:'); expect(release).toHaveBeenLastCalledWith(new Set(['gamepad:20:a']));
    expect(input.hasSource('pointer:2')).toBe(true);
    const next = { setButton: vi.fn(), setKeyboardKey: vi.fn() } as unknown as EmulatorAdapter;
    input.attach(next); expect(release).toHaveBeenLastCalledWith(new Set(['pointer:2']));
    expect(adapter.setButton).toHaveBeenLastCalledWith(1, 'a', false); expect(next.setButton).not.toHaveBeenCalled();
    expect(input.getSnapshot().buttons.size).toBe(0);
  });
});
