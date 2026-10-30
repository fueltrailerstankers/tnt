import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonClass } from './styles';

export interface BulkBarProps {
  /** Selected rows on this page. The bar hides at zero. */
  count: number;
  /** Actions, usually accent-outline 30px buttons ("Mark read", "Export selected"). */
  children?: ReactNode;
  /** Clears the selection (client parents). */
  onClear?: () => void;
  /** Or a link that clears it via the URL. */
  clearHref?: string;
  /** Stick to the top of the scrolling area (phones). */
  sticky?: boolean;
}

/** "{n} selected" bar shown above a table while rows are selected. */
export function BulkBar({ count, children, onClear, clearHref, sticky = false }: BulkBarProps) {
  if (count < 1) return null;
  const clear = buttonClass('link', 36, 'ml-auto');
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className={`flex flex-wrap items-center gap-2.5 border-b border-border bg-accent-soft px-3.5 py-2 text-small font-semibold text-accent-text ${sticky ? 'sticky top-0 z-[2]' : ''}`}
    >
      <span role="status">{count} selected</span>
      {children}
      {onClear ? (
        <button type="button" onClick={onClear} className={clear}>Clear</button>
      ) : clearHref ? (
        <Link href={clearHref} className={clear}>Clear</Link>
      ) : null}
    </div>
  );
}
