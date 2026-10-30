import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * zar: outlined currency code (any code: pass it as children). auto: "Auto-created from Xero". encrypted: lock +
 * "Encrypted". test: "TEST" lead. neutral: source tags ("Manual"). warning: duplicate and similar yellow notes.
 * For the unread dot and nav counts use UnreadDot and CountBadge.
 */
export type BadgeVariant = 'zar' | 'auto' | 'encrypted' | 'test' | 'neutral' | 'warning';

const LOOK: Record<BadgeVariant, string> = {
  zar: 'border border-border-strong tracking-[0.4px] text-fg-muted',
  auto: 'bg-accent-soft text-accent-text',
  encrypted: 'bg-surface-2 text-fg-muted',
  test: 'bg-status-yellow-bg text-status-yellow-fg',
  neutral: 'bg-surface-2 text-fg-muted',
  warning: 'bg-status-yellow-bg text-status-yellow-fg',
};

const PAD_X: Record<BadgeVariant, string> = {
  zar: 'px-1.5', auto: 'px-[7px]', encrypted: 'px-[7px]', test: 'px-[7px]', neutral: 'px-1.5', warning: 'px-[7px]',
};

const DEFAULT_LABEL: Partial<Record<BadgeVariant, string>> = {
  zar: 'ZAR',
  auto: 'Auto-created from Xero',
  encrypted: 'Encrypted',
  test: 'TEST',
};

const ICON: Partial<Record<BadgeVariant, IconName>> = { auto: 'refresh', encrypted: 'lock', warning: 'warning' };

export function Badge({ variant = 'neutral', children, size = 'md' }: { variant?: BadgeVariant; children?: ReactNode; size?: 'sm' | 'md' }) {
  const icon = ICON[variant];
  const box = size === 'sm' ? 'py-px text-[10px] leading-[14px]' : 'py-0.5 text-[11px] leading-4';
  const padX = size === 'sm' ? 'px-[5px]' : PAD_X[variant];
  return (
    <span className={`inline-flex flex-none items-center gap-[5px] whitespace-nowrap rounded-xs font-semibold ${LOOK[variant]} ${box} ${padX}`}>
      {icon ? <Icon name={icon} size={12} strokeWidth={2} /> : null}
      {children ?? DEFAULT_LABEL[variant]}
    </span>
  );
}
