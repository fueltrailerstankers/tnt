import type { ComponentPropsWithRef } from 'react';
import { Icon, type IconName } from './Icon';

export type IconButtonSize = 32 | 36 | 44;
export type IconButtonVariant = 'secondary' | 'ghost';

const SIZE: Record<IconButtonSize, string> = { 32: 'size-8', 36: 'size-9', 44: 'size-11' };
const ICON: Record<IconButtonSize, number> = { 32: 16, 36: 18, 44: 20 };

const VARIANT: Record<IconButtonVariant, string> = {
  secondary: 'border border-border-strong bg-surface text-fg hover:bg-surface-2 disabled:border-border disabled:text-fg-muted',
  ghost: 'border border-transparent bg-transparent text-fg-muted hover:bg-surface-2 hover:text-fg disabled:text-fg-subtle',
};

/** Round icon-only control classes, also for <Link>/<a> (pagination). */
export function iconButtonClass(variant: IconButtonVariant = 'secondary', size: IconButtonSize = 36, extra = ''): string {
  return `inline-flex flex-none items-center justify-center rounded-pill no-underline transition disabled:cursor-not-allowed disabled:hover:bg-transparent ${SIZE[size]} ${VARIANT[variant]} ${extra}`.trim();
}

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'aria-label'> {
  /** Required accessible name ("More actions", "Close", "Next page"). */
  label: string;
  icon: IconName;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  iconSize?: number;
}

/** Icon-only button. The label is the accessible name; the icon is decorative. */
export function IconButton({ label, icon, size = 36, variant = 'secondary', iconSize, className = '', type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} className={iconButtonClass(variant, size, className)} {...rest}>
      <Icon name={icon} size={iconSize ?? ICON[size]} strokeWidth={2} />
    </button>
  );
}
