import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface EmptyStateProps {
  title: ReactNode;
  body?: ReactNode;
  /** A link (13px/600 accent text) or a Button. */
  action?: ReactNode;
  icon?: IconName;
  /** `card`: dashed box on its own. `plain`: inside a table or card (no border, more vertical room). */
  variant?: 'card' | 'plain';
}

/** "Nothing needs you right now" style message with an icon circle and an optional next step. */
export function EmptyState({ title, body, action, icon = 'tasks', variant = 'card' }: EmptyStateProps) {
  const box = variant === 'card' ? 'rounded-md border border-dashed border-border-strong bg-surface px-5 py-7' : 'px-5 py-10';
  return (
    <div className={`flex flex-col items-center gap-2 text-center ${box}`}>
      <span className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-fg-muted">
        <Icon name={icon} size={18} />
      </span>
      <p className="m-0 text-[15px] font-semibold leading-[22px] text-fg">{title}</p>
      {body ? <p className="m-0 max-w-sm text-small text-fg-muted">{body}</p> : null}
      {action ? <div className="text-small font-semibold">{action}</div> : null}
    </div>
  );
}
