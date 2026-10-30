'use client';

import { useEffect, useRef, type RefObject } from 'react';

// Shared modal behaviour for Drawer, Modal and TypedConfirmModal: initial focus, Tab trap, Escape, body scroll lock
// and focus back to the trigger on close. Only the top-most open dialog reacts to keys, so a Modal opened from a
// Drawer closes on its own.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Visible, enabled, tabbable descendants in DOM order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[inert]') && el.getClientRects().length > 0);
}

const stack: symbol[] = [];
let scrollLocks = 0;
let savedOverflow = '';

function lockScroll() {
  if (scrollLocks++ === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
}

function unlockScroll() {
  if (--scrollLocks === 0) document.body.style.overflow = savedOverflow;
}

export interface DialogOptions {
  open: boolean;
  onClose: () => void;
  /** The dialog element (give it tabIndex={-1}). Tab stays inside it. */
  ref: RefObject<HTMLElement | null>;
  /** Focused on open. Defaults to the first focusable element, then the dialog itself. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** False while something is pending: Escape does nothing. */
  dismissible?: boolean;
}

export function useDialog({ open, onClose, ref, initialFocus, dismissible = true }: DialogOptions): void {
  const latest = useRef({ onClose, dismissible });
  useEffect(() => {
    latest.current = { onClose, dismissible };
  });

  useEffect(() => {
    if (!open) return;
    const id = Symbol('dialog');
    stack.push(id);
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockScroll();

    const root = ref.current;
    const first = initialFocus?.current ?? (root ? focusableIn(root)[0] : null) ?? root;
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      const box = ref.current;
      if (e.key === 'Escape') {
        if (!latest.current.dismissible) return;
        e.preventDefault();
        latest.current.onClose();
        return;
      }
      if (e.key !== 'Tab' || !box) return;
      const items = focusableIn(box);
      if (!items.length) {
        e.preventDefault();
        box.focus();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      const active = document.activeElement;
      if (!box.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? tail : head).focus();
      } else if (e.shiftKey && (active === head || active === box)) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && active === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      const at = stack.indexOf(id);
      if (at >= 0) stack.splice(at, 1);
      unlockScroll();
      if (trigger && trigger.isConnected) trigger.focus();
    };
  }, [open, ref, initialFocus]);
}
