'use client';

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// Native modal dialog supplies an inert background and Escape handling.
// This narrow sheet primitive uses the existing brand tokens without new runtime dependencies.
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  variant = 'sheet',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  variant?: 'sheet' | 'command';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={'shell-modal shell-modal-' + variant}
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'
          )
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        // Keep the loop inside the sheet instead of allowing focus into browser chrome.
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onOpenChange(false);
        }
      }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-(--border-subtle) p-4">
        <h2 className="font-semibold">{title}</h2>
        <button
          type="button"
          className="shell-icon-button"
          aria-label={'Đóng ' + title}
          onClick={() => onOpenChange(false)}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
