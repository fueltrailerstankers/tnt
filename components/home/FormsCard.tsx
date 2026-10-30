import Link from 'next/link';
import { Card, CardHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import type { HomeForm } from '@/lib/home/load';

/** The seven forms: icon, name, "{n} new" (unread) and a "+" new-entry link where the member may start one. */
export function FormsCard({ forms }: { forms: HomeForm[] }) {
  return (
    <Card padding="none" aria-labelledby="home-forms-title">
      <CardHeader
        id="home-forms-title"
        title="Forms"
        className="border-b border-border px-4 py-3.5"
        action={<Link href="/admin/forms" className="font-semibold underline underline-offset-2">Manage</Link>}
      />
      <ul className="m-0 list-none p-1.5">
        {forms.map((f) => (
          <li key={f.slug} data-testid={`form-row-${f.slug}`} className="flex items-center gap-2.5 rounded-sm px-2.5 py-1.5">
            <span aria-hidden="true" className="flex size-[30px] flex-none items-center justify-center rounded-sm bg-surface-2 text-fg-muted">
              <Icon name={f.icon} size={16} />
            </span>
            <Link href={f.href} className="min-w-0 flex-1 text-body font-medium text-fg no-underline hover:underline">{f.label}</Link>
            {f.unread > 0 ? (
              <Link
                href={`${f.href}?view=unread`}
                data-testid={`unread-${f.slug}`}
                aria-label={`${f.unread} new in ${f.label}`}
                className="text-[12px] font-semibold leading-4 text-accent-text no-underline hover:underline"
              >
                {f.unread} new
              </Link>
            ) : null}
            {f.newHref ? (
              <Link
                href={f.newHref}
                aria-label={`New ${f.label} entry`}
                className="flex size-[30px] flex-none items-center justify-center rounded-pill border border-border text-fg hover:bg-surface-2"
              >
                <Icon name="plus" size={14} strokeWidth={2} />
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
