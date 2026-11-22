import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

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
    const previous = document.activeElement;
    dialog.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const cancel = (event: Event) => { event.preventDefault(); closeRef.current(); };
    dialog.addEventListener('cancel', cancel);
    return () => {
      document.body.style.overflow = oldOverflow;
      dialog.removeEventListener('cancel', cancel);
      dialog.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return <dialog ref={ref} className={`dialog${wide ? ' dialog-wide' : ''}`} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onClick={(event) => {
    if (event.target === ref.current) {
      const bounds = ref.current.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }
  }}>
    <div className="dialog-heading">
      <div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
      <button type="button" className="icon-button" aria-label="关闭对话框" onClick={onClose}><Icon name="close"/></button>
    </div>
    {children}
  </dialog>;
}
