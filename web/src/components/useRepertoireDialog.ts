import { RefObject, useEffect, useRef } from 'react';

const activeDialogs: HTMLElement[] = [];

/** Keep keyboard focus in the topmost active dialog and restore its trigger on close. */
export function useRepertoireDialog<T extends HTMLElement = HTMLDivElement>(
  ref: RefObject<T | null>,
  active: boolean,
  onClose?: () => void,
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!active || !ref.current) return;
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
    activeDialogs.push(dialog);
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]'
    )).filter((element) => element.getClientRects().length > 0);
    (focusable()[0] || dialog).focus();
    const handleKey = (event: KeyboardEvent) => {
      if (activeDialogs[activeDialogs.length - 1] !== dialog) return;
      if (event.key === 'Escape') {
        if (!closeRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      const idx = activeDialogs.lastIndexOf(dialog);
      if (idx !== -1) activeDialogs.splice(idx, 1);
      if (previous?.isConnected) previous.focus();
    };
  }, [active, ref]);
}
