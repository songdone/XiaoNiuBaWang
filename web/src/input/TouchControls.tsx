import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import type { ControllerButton } from '../emulator/adapter';
import type { InputController } from './controller';

export function HoldButton({ label, children, className = '', disabled, active, input, onPress, onRelease, style }: {
  label: string; children: ReactNode; className?: string; disabled?: boolean; active?: boolean; input?: InputController;
  onPress: (source: string) => void; onRelease: (source: string) => void; style?: CSSProperties;
}) {
  const held = useRef(new Set<string>());
  const buttonRef = useRef<HTMLButtonElement>(null);
  const releaseRef = useRef(onRelease);
  releaseRef.current = onRelease;
  const forget = (source: string) => {
    if (!held.current.delete(source)) return false;
    if (source.startsWith('pointer:')) {
      const pointerId = Number(source.slice('pointer:'.length));
      const button = buttonRef.current;
      try { if (button?.hasPointerCapture?.(pointerId)) button.releasePointerCapture(pointerId); }
      catch { /* Capture may already have ended, or the button may have been removed. */ }
    }
    return true;
  };
  const release = (source: string) => { if (forget(source)) releaseRef.current(source); };
  const releaseAll = () => { for (const source of [...held.current]) release(source); };
  useEffect(() => {
    const onPointerEnd = (event: PointerEvent) => release(`pointer:${event.pointerId}`);
    const onVisibility = () => { if (document.hidden) releaseAll(); };
    // Global listeners also cover browsers that fail/refuse pointer capture.
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', releaseAll);
    return () => {
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', releaseAll);
      releaseAll();
    };
  }, []);
  useEffect(() => input?.subscribeRelease((sources) => { for (const source of sources) forget(source); }), [input]);
  useEffect(() => { if (disabled) releaseAll(); }, [disabled]);
  const press = (source: string) => {
    if (!disabled && !document.querySelector('dialog[open]') && !buttonRef.current?.closest('dialog, [role="dialog"]') && !held.current.has(source)) {
      held.current.add(source); onPress(source);
    }
  };
  return <button ref={buttonRef} type="button" data-input-control className={`${className}${active ? ' held' : ''}`} style={style} aria-label={label} aria-pressed={active} disabled={disabled}
    onContextMenu={(event) => event.preventDefault()}
    onPointerDown={(event) => {
      if (disabled || event.button > 0 || document.querySelector('dialog[open]') || event.currentTarget.closest('dialog, [role="dialog"]')) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      try { event.currentTarget.setPointerCapture(event.pointerId); }
      catch { /* Global pointer end listeners still guarantee release without capture. */ }
      press(`pointer:${event.pointerId}`);
    }}
    onPointerUp={(event) => { event.preventDefault(); release(`pointer:${event.pointerId}`); }}
    onPointerCancel={(event) => release(`pointer:${event.pointerId}`)} onLostPointerCapture={(event) => release(`pointer:${event.pointerId}`)}
    onKeyDown={(event) => {
      if ((event.code === 'Space' || event.code === 'Enter') && !disabled && !event.metaKey && !event.ctrlKey && !event.altKey && !document.querySelector('dialog[open]') && !event.currentTarget.closest('dialog, [role="dialog"]')) {
        const source = `accessible:${label}:${event.code}`;
        if (event.repeat && !held.current.has(source)) return;
        event.preventDefault(); press(source);
      }
    }}
    onKeyUp={(event) => { if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); release(`accessible:${label}:${event.code}`); } }}
    onBlur={() => { for (const source of [...held.current]) if (source.startsWith('accessible:')) release(source); }}>
    {children}
  </button>;
}

export function TouchControls({ input, enabled, size = 1, opacity = 1, position = 'center' }: { input: InputController; enabled: boolean; size?: number; opacity?: number; position?: 'left' | 'center' | 'right' }) {
  const snapshot = useSyncExternalStore(input.subscribe, input.getSnapshot);
  const makeButton = (button: ControllerButton, label: string, className: string, children: ReactNode) => <HoldButton input={input} label={label} className={className} active={snapshot.buttons.has(`1:${button}`)} disabled={!enabled} onPress={(source) => input.setButton(source, 1, button, true)} onRelease={(source) => input.releaseSource(source)}>{children}</HoldButton>;
  return <div className={`touch-controls touch-${position}${!enabled ? ' disabled' : ''}`} style={{ '--touch-size': size, opacity } as CSSProperties} aria-label="屏幕手柄">
    <div className="dpad">{makeButton('up', '方向上', 'dpad-up', '↑')}{makeButton('left', '方向左', 'dpad-left', '←')}<div className="dpad-center"/>{makeButton('right', '方向右', 'dpad-right', '→')}{makeButton('down', '方向下', 'dpad-down', '↓')}</div>
    <div className="system-buttons">{makeButton('select', '选择 SELECT', 'system-key', <><span/>选择</>)}{makeButton('start', '开始 START', 'system-key', <><span/>开始</>)}</div>
    <div className="action-buttons">{makeButton('b', 'B 按键', 'action-key key-b', 'B')}{makeButton('a', 'A 按键', 'action-key key-a', 'A')}</div>
  </div>;
}
