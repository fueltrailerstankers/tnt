import Link from 'next/link';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { StatusChip } from '@/components/ui/StatusChip';
import type { HomeData } from '@/lib/home/load';
import { PhoneStatTile } from './StatTile';

const MAX_TASKS = 3;
const dash = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n);

/**
 * Phone Home (below lg; design PhoneHome): title, two tiles, the Xero alert, up to three task cards and the
 * "New entry" grid. Rendered from the same loaded data as the desktop block; no test ids here (they live on the
 * desktop block only, so they stay unique).
 */
export function PhoneHome({ data, greeting, dateLine }: { data: HomeData; greeting: string; dateLine: string }) {
  const tasks = (data.tasks?.rows ?? []).slice(0, MAX_TASKS);
  const awaiting = data.awaiting ? data.awaiting.inspections + data.awaiting.storeRoom : null;
  const banner = data.show.xero ? data.xero?.banner ?? null : null;
  return (
    <div className="flex flex-col gap-4 lg:hidden">
      <div className="flex flex-col gap-0.5">
        <h1 className="m-0 text-h1">{greeting}</h1>
        <p className="m-0 text-small text-fg-muted">{dateLine}</p>
      </div>

      {data.show.entries ? (
        <div className="grid grid-cols-2 gap-2.5">
          <PhoneStatTile href="/admin/forms" label="Unread" value={dash(data.unread?.total)} />
          <PhoneStatTile href="/admin/tasks" label="Awaiting approval" value={dash(awaiting)} />
        </div>
      ) : null}

      {banner ? (
        <Link
          href="/admin/integrations/xero"
          className="flex min-h-11 items-center gap-2.5 rounded-md bg-status-yellow-bg px-3.5 py-3 text-body font-semibold text-status-yellow-fg no-underline"
        >
          <Icon name="warning" size={18} strokeWidth={2} />
          <span className="flex-1">{banner}</span>
          <Icon name="chevronRight" size={16} strokeWidth={2} />
        </Link>
      ) : null}

      {data.show.tasks ? (
        <section aria-labelledby="phone-tasks-title" className="flex flex-col gap-2">
          <h2 id="phone-tasks-title" className="m-0 text-[15px] font-semibold leading-[22px]">My tasks</h2>
          {data.tasks === null ? (
            <p role="status" className="m-0 text-small text-fg-muted">Tasks could not be loaded. Reload the page to try again.</p>
          ) : tasks.length ? (
            tasks.map((t) => (
              <Link
                key={t.id}
                href={t.home.href}
                className="flex min-h-16 items-center gap-3 rounded-md border border-border bg-surface px-3.5 py-2.5 text-fg no-underline"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[15px] font-semibold leading-[22px]">{t.phone.title}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusChip status={t.status} color={t.statusTone} size="sm" />
                    <span className="text-[12px] leading-4 text-fg-muted">{t.phone.meta}</span>
                  </span>
                </span>
                <span className="flex-none text-fg-muted"><Icon name="chevronRight" size={18} strokeWidth={2} /></span>
              </Link>
            ))
          ) : (
            <EmptyState title="Nothing needs you right now" body="Inspections and store-room counts that need review will appear here." />
          )}
        </section>
      ) : null}

      {data.phoneNew.length ? (
        <section aria-labelledby="phone-new-title" className="flex flex-col gap-2">
          <h2 id="phone-new-title" className="m-0 text-[15px] font-semibold leading-[22px]">New entry</h2>
          <div className="grid grid-cols-2 gap-2.5">
            {data.phoneNew.map((f) => (
              <Link
                key={f.slug}
                href={f.href}
                className="flex min-h-14 items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2.5 text-body font-semibold text-fg no-underline"
              >
                <span aria-hidden="true" className="flex size-8 flex-none items-center justify-center rounded-[14px] bg-accent-soft text-accent-text">
                  <Icon name={f.icon} size={16} />
                </span>
                {f.label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {!data.show.entries && !data.show.tasks ? (
        <EmptyState icon="home" title="Nothing to show here" body="Your role has no forms or tasks. Use the menu to find your work." />
      ) : null}
    </div>
  );
}
