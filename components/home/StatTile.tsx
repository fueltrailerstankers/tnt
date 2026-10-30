import Link from 'next/link';
import type { ReactNode } from 'react';

/** Summary tile: a link card with a muted label and a big number (design Home). No shadow, per the design. */
export function StatTile({ href, label, children, testId }: { href: string; label: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-4 text-fg no-underline transition hover:border-border-strong"
    >
      <span className="text-small text-fg-muted">{label}</span>
      {children}
    </Link>
  );
}

/** Big mono number with an optional muted (or danger) note beside it. */
export function StatValue({ value, note, danger = false }: { value: ReactNode; note?: ReactNode; danger?: boolean }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="font-mono text-[28px] font-semibold leading-[36px]">{value}</span>
      {note ? <span className={`text-small ${danger ? 'font-semibold text-status-red-fg' : 'text-fg-muted'}`}>{note}</span> : null}
    </span>
  );
}

/** Phone tile: smaller padding, 26px bold sans number. */
export function PhoneStatTile({ href, label, value }: { href: string; label: string; value: ReactNode }) {
  return (
    <Link href={href} className="flex min-h-11 flex-col gap-1 rounded-md border border-border bg-surface p-3.5 text-fg no-underline">
      <span className="text-small text-fg-muted">{label}</span>
      <span className="text-[26px] font-bold leading-8">{value}</span>
    </Link>
  );
}
