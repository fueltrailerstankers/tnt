'use client';

import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';
import { useDialog } from './useDialog';
import { usePortalTarget } from './usePortalTarget';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Small line above the title, e.g. "Quote · Xero". */
  eyebrow?: ReactNode;
  /** Row under the title: status chip, contact name. */
  meta?: ReactNode;
  /** Monospaced title for references (QU-10482, INV-20931). */
  monoTitle?: boolean;
  /** Sticky footer for actions ("Open in Xero", "Go to deal file"). */
  footer?: ReactNode;
  width?: 460 | 480;
  /** Accessible name of the close button. */
  closeLabel?: string;
  children: ReactNode;
}

const WIDTH = { 460: 'sm:max-w-[460px]', 480: 'sm:max-w-[480px]' } as const;

/**
 * Right-hand panel over a scrim: role=dialog, aria-modal, labelled by its title. Focus starts on the close button,
 * Tab is trapped, Escape and a scrim click close it, and focus returns to the trigger. Full width on phones.
 * To let Back close it, keep `open` in the URL (?id=) and close with router.replace.
 */
export function Drawer({ open, onClose, title, eyebrow, meta, monoTitle = false, footer, width = 480, closeLabel = 'Close', children }: DrawerProps) {
  const target = usePortalTarget();
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const shown = open && !!target;
  useDialog({ open: shown, onClose, ref: panel, initialFocus: closeButton });

  if (!shown) return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-overlay" />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`absolute inset-y-0 right-0 flex w-full flex-col bg-surface text-fg shadow-overlay outline-none sm:rounded-l-lg ${WIDTH[width]}`}
      >
        <header className="flex flex-none items-start gap-3 border-b border-border px-5 py-[18px]">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {eyebrow ? <span className="text-[12px] leading-4 text-fg-muted">{eyebrow}</span> : null}
            <h2 id={titleId} className={`m-0 break-words ${monoTitle ? 'font-mono text-[20px] font-semibold leading-7' : 'text-h2'}`}>
              {title}
            </h2>
            {meta ? <div className="flex flex-wrap items-center gap-2 text-small text-fg-muted">{meta}</div> : null}
          </div>
          <IconButton ref={closeButton} label={closeLabel} icon="close" variant="ghost" size={36} onClick={onClose} />
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-5 py-[18px]">{children}</div>
        {footer ? <footer className="flex flex-none flex-wrap items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3.5">{footer}</footer> : null}
      </aside>
    </div>,
    target,
  );
}
