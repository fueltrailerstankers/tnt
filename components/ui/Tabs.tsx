import Link from 'next/link';

export interface TabItem { href: string; label: string; current?: boolean }

/** Link tabs: pill shape, active tab marked with an accent underline and aria-current. */
export function Tabs({ label, items }: { label: string; items: TabItem[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1 border-b border-border">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.current ? 'page' : undefined}
          className={`-mb-px rounded-t-pill border-b-2 px-4 py-2 text-body font-semibold no-underline ${t.current ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
