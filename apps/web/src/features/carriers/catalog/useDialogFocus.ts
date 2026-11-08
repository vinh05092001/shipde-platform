import { useEffect, useRef } from 'react';

/** Keep focus inside the open dialog, then return it to the invoking control. */
export function useDialogFocus(isOpen: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isOpen || !ref.current) return;
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controls = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
        )
      ).filter((element) => !element.closest('[hidden]') && element.getClientRects().length > 0);
    const focusFirst = () => (controls()[0] || dialog).focus();
    focusFirst();
    const onFocus = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) focusFirst();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const items = controls();
      const first = items[0] || dialog;
      const last = items[items.length - 1] || dialog;
      if (
        !dialog.contains(document.activeElement) ||
        document.activeElement === dialog ||
        (event.shiftKey ? document.activeElement === first : document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    // Async loading/retry can remove the currently focused control.
    const observer = new MutationObserver(() => {
      if (!dialog.contains(document.activeElement)) focusFirst();
    });
    observer.observe(dialog, { childList: true, subtree: true });
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      if (opener?.isConnected) opener.focus();
    };
  }, [isOpen]);
  return ref;
}
