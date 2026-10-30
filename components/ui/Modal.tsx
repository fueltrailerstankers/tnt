'use client';

import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';
import { useDialog } from './useDialog';
import { usePortalTarget } from './usePortalTarget';

export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Body text under the title; linked with aria-describedby. */
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons, right-aligned: Cancel (secondary) first, then the main action. */
  footer?: ReactNode;
  /** sm 440 (QR), md 480 (Go live), lg 520 (Add lead). */
  size?: ModalSize;
  /** While true, Escape, the scrim and the close button do nothing. */
  pending?: boolean;
  /** Focused on open; defaults to the first input or button after the close button. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** alertdialog for confirmations that interrupt. */
  role?: 'dialog' | 'alertdialog';
  /** Accessible name of the header close button. */
  closeLabel?: string;
}

const WIDTH: Record<ModalSize, string> = { sm: 'max-w-[440px]', md: 'max-w-[480px]', lg: 'max-w-[520px]' };

/**
 * Centred on phones, top-aligned on desktop. role=dialog (or alertdialog) with aria-modal, labelled by its title and
 * described by `description`. Focus trap, Escape, scrim click, labelled close button and focus restore via useDialog.
 */
export function Modal({
  open, onClose, title, description, children, footer, size = 'md', pending = false, initialFocus, role = 'dialog', closeLabel = 'Close',
}: ModalProps) {
  const target = usePortalTarget();
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const shown = open && !!target;
  useDialog({ open: shown, onClose, ref: box, initialFocus, dismissible: !pending });

  if (!shown) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div aria-hidden="true" onClick={pending ? undefined : onClose} className="fixed inset-0 bg-overlay" />
      <div className="pointer-events-none relative flex min-h-full items-center justify-center p-4 sm:items-start sm:pt-[20vh]">
        <div
          ref={box}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          aria-busy={pending || undefined}
          tabIndex={-1}
          className={`pointer-events-auto flex w-full flex-col gap-3.5 rounded-lg bg-surface p-[22px] text-fg shadow-overlay outline-none ${WIDTH[size]}`}
        >
          <div className="flex items-start gap-3">
            <h2 id={titleId} className="m-0 min-w-0 flex-1 break-words text-[17px] font-semibold leading-6">{title}</h2>
            <IconButton
              label={closeLabel}
              icon="close"
              variant="ghost"
              size={32}
              className="-mr-2 -mt-1"
              disabled={pending}
              onClick={onClose}
              data-dialog-close=""
            />
          </div>
          {description ? <div id={descId} className="text-body text-fg-muted">{description}</div> : null}
          {children}
          {footer ? <div className="flex flex-wrap justify-end gap-2">{footer}</div> : null}
        </div>
      </div>
    </div>,
    target,
  );
}
