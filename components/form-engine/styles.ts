// Field styling for the form renderer. Tokens only. Phone-first: 48px controls and 16px text below 640px
// (no iOS zoom), 40px and 14px from 640px up (handoff section 1 density rules).

const base =
  'block w-full rounded-sm border bg-surface px-3 text-base text-fg placeholder:text-fg-subtle outline-none transition focus:border-focus focus:ring-2 focus:ring-focus/25 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-muted sm:text-body';

export function inputCls(err?: string | boolean, extra = ''): string {
  return `${base} h-12 sm:h-10 ${err ? 'border-2 border-danger' : 'border-border-strong'} ${extra}`.trim();
}

export function textareaCls(err?: string | boolean): string {
  return `${base} min-h-24 py-2.5 leading-6 ${err ? 'border-2 border-danger' : 'border-border-strong'}`;
}

export const labelCls = 'mb-1.5 block text-small font-semibold text-fg';
export const partLabelCls = 'mb-1 block text-label font-medium tracking-normal text-fg-muted';
export const errorCls = 'mt-1.5 text-small font-medium text-status-red-fg';

export const primaryBtn =
  'inline-flex h-12 items-center justify-center gap-2 rounded-pill bg-accent px-6 text-[15px] font-semibold text-accent-fg transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:h-11';
export const secondaryBtn =
  'inline-flex h-12 items-center justify-center gap-2 rounded-pill border border-border-strong bg-surface px-5 text-[15px] font-semibold text-fg transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60 sm:h-11';

/** "29 Oct 2026, 14:31 SAST" for a client-side moment (display only; the server stores UTC). */
export function sastStamp(d: Date): string {
  const s = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d);
  return `${s} SAST`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
