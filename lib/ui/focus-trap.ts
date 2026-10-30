// Keyboard rules for modal dialogs (Drawer, Modal, TypedConfirmModal via components/ui/useDialog). Pure and
// DOM-free so they are unit-tested; the hook supplies the elements.

export type DialogKeyAction = 'close' | 'trap' | 'ignore';

export interface DialogKeyState {
  key: string;
  /** Only the top-most open dialog reacts, so a Modal opened from a Drawer closes on its own. */
  isTop: boolean;
  /** False while something is pending: Escape does nothing. */
  dismissible: boolean;
  /** A popover inside the dialog (column picker, menu) already handled this Escape. */
  defaultPrevented: boolean;
}

/** What a keydown means for an open dialog. */
export function dialogKeyAction(s: DialogKeyState): DialogKeyAction {
  if (!s.isTop) return 'ignore';
  if (s.key === 'Escape') return s.dismissible && !s.defaultPrevented ? 'close' : 'ignore';
  if (s.key === 'Tab') return 'trap';
  return 'ignore';
}

/**
 * Where Tab or Shift+Tab should move focus to keep it inside the dialog, or null to let the browser move it
 * normally. `items` are the dialog's tabbable elements in DOM order; `box` is the dialog itself (tabIndex -1).
 */
export function trapFocusTarget<T>(items: readonly T[], active: T | null, box: T, shift: boolean, activeInside: boolean): T | null {
  if (!items.length) return box;
  const head = items[0];
  const tail = items[items.length - 1];
  if (!activeInside) return shift ? tail : head;
  if (shift && (active === head || active === box)) return tail;
  if (!shift && active === tail) return head;
  return null;
}

/**
 * The element to focus when a dialog opens: the caller's choice, else the first tabbable element that is not the
 * header close button (so focus lands on the first input or the main action), else the close button, else the box.
 */
export function initialFocusTarget<T>(preferred: T | null | undefined, items: readonly T[], isClose: (el: T) => boolean, box: T): T {
  if (preferred) return preferred;
  return items.find((el) => !isClose(el)) ?? items[0] ?? box;
}
