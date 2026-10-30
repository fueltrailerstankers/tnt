import type { ReactNode } from 'react';

/** Stock page header: small uppercase eyebrow, H1, one-line subtitle, optional action on the right. */
export function StockHeader({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="text-label uppercase text-accent-text">{eyebrow}</p>
        <h1 className="text-h1">{title}</h1>
        {subtitle ? <p className="text-body text-fg-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
    </header>
  );
}
