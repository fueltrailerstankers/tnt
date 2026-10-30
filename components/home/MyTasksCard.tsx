import Link from 'next/link';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusChip } from '@/components/ui/StatusChip';
import type { TaskRow } from '@/lib/tasks/build';

const MAX = 5;

/** Compact "My tasks" list: kind chip, title, meta and a navigation link (no mutations on Home). */
export function MyTasksCard({ rows }: { rows: TaskRow[] | null }) {
  const shown = (rows ?? []).slice(0, MAX);
  return (
    <Card padding="none" aria-labelledby="home-tasks-title" data-testid="home-tasks">
      <CardHeader
        id="home-tasks-title"
        title="My tasks"
        className="border-b border-border px-4 py-3.5"
        action={<Link href="/admin/tasks" className="font-semibold underline underline-offset-2">View all</Link>}
      />
      {rows === null ? (
        <p role="status" className="m-0 px-4 py-6 text-small text-fg-muted">Tasks could not be loaded. Reload the page to try again.</p>
      ) : shown.length ? (
        <ul className="m-0 list-none divide-y divide-border p-0">
          {shown.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex-none"><StatusChip status={t.home.kind} color={t.home.kindTone} /></span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-body font-medium text-fg">{t.home.title}</span>
                <span className="text-[12px] leading-4 text-fg-muted">{t.home.meta}</span>
              </span>
              <Link
                href={t.home.href}
                aria-label={`${t.home.action}: ${t.home.title}`}
                className="inline-flex h-8 flex-none items-center rounded-pill border border-border-strong px-3 text-small font-medium text-fg no-underline hover:bg-surface-2"
              >
                {t.home.action}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState variant="plain" title="Nothing needs you right now" body="Inspections and store-room counts that need review will appear here." />
      )}
    </Card>
  );
}
