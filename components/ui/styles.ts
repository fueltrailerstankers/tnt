// Shared class strings for buttons, inputs and surfaces. Tokens only; no hex values.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 36 | 44 | 52;

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg border border-transparent hover:brightness-95',
  secondary: 'bg-surface text-fg border border-border-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-fg border border-transparent hover:bg-surface-2',
  destructive: 'bg-danger text-white border border-transparent hover:brightness-95',
};

const SIZE: Record<ButtonSize, string> = {
  36: 'h-9 px-3.5 text-body',
  44: 'h-11 px-5 text-[15px]',
  52: 'h-[52px] px-6 text-base',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 36, extra = ''): string {
  return `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-semibold no-underline transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${extra}`.trim();
}

/** Inputs are 10px radius; 16px text on phones so iOS does not zoom. */
export const inputClass =
  'w-full rounded-sm border border-border-strong bg-surface px-3 py-2.5 text-base text-fg placeholder:text-fg-subtle outline-none focus:border-focus focus:ring-2 focus:ring-focus/25 disabled:bg-surface-2 aria-[invalid=true]:border-2 aria-[invalid=true]:border-danger sm:text-body';

export const labelClass = 'mb-1.5 block text-small font-semibold text-fg';

export const cardClass = 'rounded-md border border-border bg-surface shadow-card';

export const tableWrapClass = 'overflow-x-auto rounded-md border border-border bg-surface shadow-card';
export const tableClass = 'w-full border-collapse text-body';
export const theadClass = 'bg-surface-2 text-left text-label font-semibold text-fg-muted';
