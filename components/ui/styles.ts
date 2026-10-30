// Shared class strings for buttons, inputs and surfaces. Tokens only; no hex values.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'destructive-outline' | 'accent-outline' | 'link';
export type ButtonSize = 30 | 32 | 36 | 38 | 44 | 48 | 52;

/** Disabled (design): neutral surface, subtle text and a border, no opacity. Destructive fades instead. */
const QUIET_DISABLED = 'disabled:border-border disabled:bg-surface-2 disabled:text-fg-subtle';

const VARIANT: Record<ButtonVariant, { look: string; disabled: string }> = {
  primary: { look: 'bg-accent text-accent-fg border border-transparent font-semibold hover:brightness-95', disabled: QUIET_DISABLED },
  secondary: { look: 'bg-surface text-fg border border-border-strong font-medium hover:bg-surface-2', disabled: QUIET_DISABLED },
  ghost: { look: 'bg-transparent text-fg border border-transparent font-medium hover:bg-surface-2', disabled: 'disabled:bg-transparent disabled:text-fg-subtle' },
  destructive: { look: 'bg-danger text-white border border-transparent font-semibold hover:brightness-95', disabled: 'disabled:opacity-45 disabled:hover:brightness-100' },
  'destructive-outline': { look: 'bg-surface text-status-red-fg border border-danger font-semibold hover:bg-status-red-bg', disabled: QUIET_DISABLED },
  'accent-outline': { look: 'bg-surface text-accent-text border border-accent font-semibold hover:bg-accent-soft', disabled: QUIET_DISABLED },
  link: { look: 'bg-transparent text-accent-text border-0 p-1 text-small font-semibold hover:underline', disabled: 'disabled:text-fg-subtle disabled:no-underline' },
};

const SIZE: Record<ButtonSize, string> = {
  30: 'h-[30px] px-2.5 text-small',
  32: 'h-8 px-2.5 text-small',
  36: 'h-9 px-3.5 text-body',
  38: 'h-[38px] px-3.5 text-body',
  44: 'h-11 px-5 text-[15px]',
  48: 'h-12 px-5 text-base',
  52: 'h-[52px] px-6 text-base',
};

/**
 * Pill button classes, also for <Link>/<a>. `loading` keeps the variant's colours at 80% opacity (the button is
 * disabled while it spins) instead of the grey disabled look. The `link` variant ignores `size`.
 */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 36, extra = '', state: { loading?: boolean } = {}): string {
  const v = VARIANT[variant];
  const busy = state.loading ? 'opacity-80 cursor-progress' : `disabled:cursor-not-allowed ${v.disabled}`;
  const box = variant === 'link' ? '' : SIZE[size];
  return `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill no-underline transition ${v.look} ${box} ${busy} ${extra}`.replace(/\s+/g, ' ').trim();
}

/** Inputs are 10px radius; 16px text on phones so iOS does not zoom. */
export const inputClass =
  'w-full rounded-sm border border-border-strong bg-surface px-3 py-2.5 text-base text-fg placeholder:text-fg-subtle outline-none focus:border-focus focus:ring-2 focus:ring-focus/25 disabled:bg-surface-2 aria-[invalid=true]:border-2 aria-[invalid=true]:border-danger sm:text-body';

export const labelClass = 'mb-1.5 block text-small font-semibold text-fg';

export const cardClass = 'rounded-md border border-border bg-surface shadow-card';

export const tableWrapClass = 'overflow-x-auto rounded-md border border-border bg-surface shadow-card';
export const tableClass = 'w-full border-collapse text-body';
export const theadClass = 'bg-surface-2 text-left text-label font-semibold text-fg-muted';
