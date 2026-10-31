import Link from 'next/link';
import type { FocusEventHandler, MouseEventHandler } from 'react';
import { toastRole, type ToastTone } from '@/lib/ui/toast';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';

const ICON: Record<ToastTone, { name: IconName; className: string; stroke: number; srLabel: string }> = {
  success: { name: 'check', className: 'text-status-green-fg', stroke: 2.5, srLabel: 'Success' },
  error: { name: 'warning', className: 'text-status-red-fg', stroke: 2, srLabel: 'Error' },
  info: { name: 'info', className: 'text-fg-muted', stroke: 2, srLabel: 'Note' },
};

export interface ToastProps {
  tone?: ToastTone;
  title: string;
  body?: string;
  action?: { label: string; href: string };
  /** Shows a Dismiss button. */
  onDismiss?: () => void;
  /**
   * Make the card its own live region (role=status, or role=alert for errors). Leave it off inside ToastProvider,
   * which announces through persistent live regions so the message is read reliably and only once.
   */
  announce?: boolean;
  onMouseEnter?: MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: MouseEventHandler<HTMLDivElement>;
  onFocus?: FocusEventHandler<HTMLDivElement>;
  onBlur?: FocusEventHandler<HTMLDivElement>;
}

/** One toast card. Use useToast() to show and announce one; this only renders it. */
export function Toast({ tone = 'success', title, body, action, onDismiss, announce = false, ...handlers }: ToastProps) {
  const icon = ICON[tone];
  return (
    <div
      role={announce ? toastRole(tone) : undefined}
      data-tone={tone}
      className="toast-enter pointer-events-auto flex w-full max-w-[380px] items-start gap-2.5 rounded-md border border-border bg-surface px-3.5 py-3 text-fg shadow-overlay"
      {...handlers}
    >
      <span className={`mt-px flex-none ${icon.className}`}>
        <Icon name={icon.name} size={16} strokeWidth={icon.stroke} />
        <span className="sr-only">{icon.srLabel}: </span>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body font-semibold">{title}</span>
        {body || action ? (
          <span className="text-small text-fg-muted">
            {body}
            {body && action ? ' · ' : null}
            {action ? <Link href={action.href} className="font-semibold text-accent-text">{action.label}</Link> : null}
          </span>
        ) : null}
      </div>
      {onDismiss ? <IconButton label="Dismiss" icon="close" variant="ghost" size={32} iconSize={14} className="-my-1 -mr-1.5" onClick={onDismiss} /> : null}
    </div>
  );
}
