import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import type { ControllerButton } from '../emulator/adapter';
import type { InputController } from './controller';

function triggerHaptic(enabled: boolean) {
  if (!enabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try { navigator.vibrate(12); } catch { /* Ignore unsupported or blocked haptics. */ }
}

export function HoldButton({ label, children, className = '', disabled, active, input, haptics = false, onPress, onRelease, style }: {
  label: string; children: ReactNode; className?: string; disabled?: boolean; active?: boolean; input?: InputController; haptics?: boolean;
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
      if (event.pointerType === 'touch') triggerHaptic(haptics);
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

const DIRECTIONS: ControllerButton[] = ['up', 'down', 'left', 'right'];

function resolveDirectionsFromPoint(rect: DOMRect, clientX: number, clientY: number): ControllerButton[] {
  if (rect.width <= 0 || rect.height <= 0) return [];
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = (clientX - cx) / (rect.width / 2);
  const dy = (clientY - cy) / (rect.height / 2);
  const dist = Math.hypot(dx, dy);
  if (dist < 0.16) return [];
  const angle = Math.atan2(dy, dx); // -PI..PI; 0 = right, PI/2 = down
  const dirs: ControllerButton[] = [];
  // 8-way sectors: diagonals occupy 45° windows around ±45° and ±135°
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  if (cos > 0.38) dirs.push('right');
  else if (cos < -0.38) dirs.push('left');
  if (sin > 0.38) dirs.push('down');
  else if (sin < -0.38) dirs.push('up');
  return dirs;
}

function SlidingDPad({ input, enabled, haptics = false, activeButtons }: { input: InputController; enabled: boolean; haptics?: boolean; activeButtons: ReadonlySet<string> }) {
  const padRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Set<ControllerButton>>());

  const applyPointerDirs = (pointerId: number, nextDirs: ControllerButton[], isTouch = false) => {
    const prev = pointers.current.get(pointerId) ?? new Set<ControllerButton>();
    const next = new Set(nextDirs);
    const source = `dpad-pointer:${pointerId}`;
    let newlyPressed = false;
    for (const dir of prev) {
      if (!next.has(dir)) input.setButton(source, 1, dir, false);
    }
    for (const dir of next) {
      if (!prev.has(dir)) { input.setButton(source, 1, dir, true); newlyPressed = true; }
    }
    if (newlyPressed && isTouch) triggerHaptic(haptics);
    pointers.current.set(pointerId, next);
  };

  const releasePointer = (pointerId: number) => {
    const pad = padRef.current;
    try { if (pad?.hasPointerCapture?.(pointerId)) pad.releasePointerCapture(pointerId); }
    catch { /* Ignore capture release errors. */ }
    if (!pointers.current.has(pointerId)) return;
    pointers.current.delete(pointerId);
    input.releaseSource(`dpad-pointer:${pointerId}`);
  };

  const releaseAllPointers = () => {
    for (const pointerId of [...pointers.current.keys()]) releasePointer(pointerId);
  };

  useEffect(() => {
    const onEnd = (event: PointerEvent) => releasePointer(event.pointerId);
    const onVisibility = () => { if (document.hidden) releaseAllPointers(); };
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    window.addEventListener('blur', releaseAllPointers);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', releaseAllPointers);
    return () => {
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('blur', releaseAllPointers);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', releaseAllPointers);
      releaseAllPointers();
    };
  }, []);

  useEffect(() => input.subscribeRelease((sources) => {
    for (const source of sources) {
      if (source.startsWith('dpad-pointer:')) {
        const id = Number(source.slice('dpad-pointer:'.length));
        pointers.current.delete(id);
      }
    }
  }), [input]);

  useEffect(() => { if (!enabled) releaseAllPointers(); }, [enabled]);

  const computeDirs = (event: React.PointerEvent<HTMLDivElement>): ControllerButton[] => {
    const pad = padRef.current;
    if (!pad) return [];
    const rect = pad.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && (event.clientX !== 0 || event.clientY !== 0)) {
      return resolveDirectionsFromPoint(rect, event.clientX, event.clientY);
    }
    const targetDir = (event.target instanceof Element ? event.target.closest('[data-dir]')?.getAttribute('data-dir') : null) as ControllerButton | null;
    return targetDir && DIRECTIONS.includes(targetDir) ? [targetDir] : [];
  };

  const makeDirKey = (dir: ControllerButton, label: string, className: string, arrow: string) => {
    const active = activeButtons.has(`1:${dir}`);
    return <button type="button" data-input-control data-dir={dir} className={`${className}${active ? ' held' : ''}`} aria-label={label} aria-pressed={active} disabled={!enabled}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if ((event.code === 'Space' || event.code === 'Enter') && enabled && !event.metaKey && !event.ctrlKey && !event.altKey && !document.querySelector('dialog[open]')) {
          const source = `accessible:${label}:${event.code}`;
          if (event.repeat && !input.hasSource(source)) return;
          event.preventDefault();
          input.setButton(source, 1, dir, true);
        }
      }}
      onKeyUp={(event) => {
        if (event.code === 'Space' || event.code === 'Enter') {
          event.preventDefault();
          input.releaseSource(`accessible:${label}:${event.code}`);
        }
      }}
      onBlur={() => {
        input.releasePrefix(`accessible:${label}:`);
      }}>
      {arrow}
    </button>;
  };

  return <div ref={padRef} className="dpad dpad-sliding" role="group" aria-label="方向十字键（支持滑动与斜向）" data-input-control
    onContextMenu={(event) => event.preventDefault()}
    onPointerDown={(event) => {
      if (!enabled || event.button > 0 || document.querySelector('dialog[open]') || event.currentTarget.closest('dialog, [role="dialog"]')) return;
      event.preventDefault();
      try { event.currentTarget.setPointerCapture(event.pointerId); }
      catch { /* Global pointer end listeners guarantee release. */ }
      applyPointerDirs(event.pointerId, computeDirs(event), event.pointerType === 'touch');
    }}
    onPointerMove={(event) => {
      if (!enabled || !pointers.current.has(event.pointerId)) return;
      event.preventDefault();
      applyPointerDirs(event.pointerId, computeDirs(event), event.pointerType === 'touch');
    }}
    onPointerUp={(event) => { event.preventDefault(); releasePointer(event.pointerId); }}
    onPointerCancel={(event) => releasePointer(event.pointerId)}
    onLostPointerCapture={(event) => releasePointer(event.pointerId)}>
    {makeDirKey('up', '方向上', 'dpad-up', '↑')}
    {makeDirKey('left', '方向左', 'dpad-left', '←')}
    <div className="dpad-center"/>
    {makeDirKey('right', '方向右', 'dpad-right', '→')}
    {makeDirKey('down', '方向下', 'dpad-down', '↓')}
  </div>;
}

export function TouchControls({ input, enabled, size = 1, opacity = 1, position = 'center', haptics = false }: { input: InputController; enabled: boolean; size?: number; opacity?: number; position?: 'left' | 'center' | 'right'; haptics?: boolean }) {
  const snapshot = useSyncExternalStore(input.subscribe, input.getSnapshot);
  const makeButton = (button: ControllerButton, label: string, className: string, children: ReactNode) => <HoldButton input={input} haptics={haptics} label={label} className={className} active={snapshot.buttons.has(`1:${button}`)} disabled={!enabled} onPress={(source) => input.setButton(source, 1, button, true)} onRelease={(source) => input.releaseSource(source)}>{children}</HoldButton>;
  const makeTurbo = (button: 'a' | 'b', label: string, className: string, children: ReactNode) => <HoldButton input={input} haptics={haptics} label={label} className={className} active={snapshot.turbo.has(`1:${button}`)} disabled={!enabled} onPress={(source) => input.setTurbo(source, 1, button, true)} onRelease={(source) => input.releaseSource(source)}>{children}</HoldButton>;
  return <div className={`touch-controls touch-${position}${!enabled ? ' disabled' : ''}`} style={{ '--touch-size': size, opacity } as CSSProperties} aria-label="屏幕手柄">
    <SlidingDPad input={input} enabled={enabled} haptics={haptics} activeButtons={snapshot.buttons}/>
    <div className="system-buttons">{makeButton('select', '选择 SELECT', 'system-key', <><span/>选择</>)}{makeButton('start', '开始 START', 'system-key', <><span/>开始</>)}</div>
    <div className="action-buttons-cluster">
      <div className="turbo-buttons">{makeTurbo('b', '连发 B', 'turbo-key', '连B')}{makeTurbo('a', '连发 A', 'turbo-key', '连A')}</div>
      <div className="action-buttons">{makeButton('b', 'B 按键', 'action-key key-b', 'B')}{makeButton('a', 'A 按键', 'action-key key-a', 'A')}</div>
    </div>
  </div>;
}
