import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

function isOutsideDialog(event: PointerEvent, dialog: HTMLDialogElement): boolean {
  const bounds = dialog.getBoundingClientRect();
  return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
}

export function Dialog({ title, description, children, onClose, wide = false }: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    let cleaningUp = false;
    let pressedOutside = false;
    dialog.showModal();
    const cancel = (event: Event) => { event.preventDefault(); closeRef.current(); };
    const closed = () => { if (!cleaningUp) closeRef.current(); };
    dialog.addEventListener('cancel', cancel);
    dialog.addEventListener('close', closed);
    const hasNativeClosedBy = typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;
    const onPointerDown = (event: PointerEvent) => { pressedOutside = isOutsideDialog(event, dialog); };
    const onPointerUp = (event: PointerEvent) => {
      if (pressedOutside && isOutsideDialog(event, dialog)) closeRef.current();
      pressedOutside = false;
    };
    if (!hasNativeClosedBy) {
      dialog.addEventListener('pointerdown', onPointerDown);
      dialog.addEventListener('pointerup', onPointerUp);
    }
    return () => {
      cleaningUp = true;
      dialog.removeEventListener('cancel', cancel);
      dialog.removeEventListener('close', closed);
      if (!hasNativeClosedBy) {
        dialog.removeEventListener('pointerdown', onPointerDown);
        dialog.removeEventListener('pointerup', onPointerUp);
      }
      if (dialog.open) dialog.close();
    };
  }, []);
  return <dialog ref={ref} {...({ closedby: 'any' } as Record<string, string>)} className={`dialog${wide ? ' dialog-wide' : ''}`} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}>
    <div className="dialog-heading">
      <div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
      <button type="button" className="icon-button" aria-label="关闭对话框" onClick={onClose}><Icon name="close"/></button>
    </div>
    <div className="dialog-body">{children}</div>
  </dialog>;
}
