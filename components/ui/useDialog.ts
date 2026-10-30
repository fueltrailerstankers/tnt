'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { dialogKeyAction, initialFocusTarget, trapFocusTarget } from '@/lib/ui/focus-trap';

// Shared modal behaviour for Drawer, Modal and TypedConfirmModal: initial focus, Tab trap, Escape, body scroll lock
// and focus back to the trigger on close. Only the top-most open dialog reacts to keys (lib/ui/focus-trap.ts).

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Put `data-dialog-close=""` on a dialog header close button so initial focus skips it for the first input or action. */
export const DIALOG_CLOSE_ATTR = 'data-dialog-close';

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
  /** Focused on open. Defaults to the first focusable element that is not the close button, then the dialog itself. */
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
    if (root) {
      initialFocusTarget(initialFocus?.current, focusableIn(root), (el) => el.hasAttribute(DIALOG_CLOSE_ATTR), root).focus();
    }

    const onKey = (e: KeyboardEvent) => {
      const box = ref.current;
      const action = dialogKeyAction({
        key: e.key,
        isTop: stack[stack.length - 1] === id,
        dismissible: latest.current.dismissible,
        defaultPrevented: e.defaultPrevented,
      });
      if (action === 'close') {
        e.preventDefault();
        latest.current.onClose();
        return;
      }
      if (action !== 'trap' || !box) return;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const target = trapFocusTarget(focusableIn(box), active, box, e.shiftKey, !!active && box.contains(active));
      if (target) {
        e.preventDefault();
        target.focus();
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
