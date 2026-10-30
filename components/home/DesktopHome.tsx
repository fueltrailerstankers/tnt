import { EmptyState } from '@/components/ui/EmptyState';
import type { HomeData } from '@/lib/home/load';
import { plural } from '@/lib/tasks/format';
import { FormsCard } from './FormsCard';
import { HomeHeader } from './HomeHeader';
import { MyTasksCard } from './MyTasksCard';
import { RecentEntriesCard } from './RecentEntriesCard';
import { StatTile, StatValue } from './StatTile';
import { SyncByEntityCard } from './SyncByEntityCard';
import { XeroHealthTile } from './XeroHealthTile';

const dash = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n);

/** Desktop Home (lg and up; design Home / HomeDark). Every block is gated on the member's permissions. */
export function DesktopHome({ data, greeting, dateLine }: { data: HomeData; greeting: string; dateLine: string }) {
  const { show } = data;
  const tasks = data.tasks;
  const failed = tasks?.failedJobs ?? 0;
  const hasLeft = show.tasks || show.entries;
  const hasRight = (show.entries && data.forms) || (show.xero && data.xero);
  return (
    <div className="hidden flex-col gap-5 lg:flex">
      <HomeHeader greeting={greeting} dateLine={dateLine} newDealHref={data.newDealHref} />

      {show.entries || show.tasks || show.xero ? (
        <section aria-label="Summary" className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))]">
          {show.entries ? (
            <StatTile href="/admin/forms" label="Unread entries" testId="tile-unread">
              <StatValue
                value={dash(data.unread?.total)}
                note={data.unread?.total ? `across ${plural(data.unread.forms, 'form')}` : undefined}
              />
            </StatTile>
          ) : null}
          {show.tasks ? (
            <StatTile href="/admin/tasks" label="My tasks" testId="tile-tasks">
              <StatValue value={dash(tasks?.rows.length)} note={failed ? plural(failed, 'failed job') : undefined} danger />
            </StatTile>
          ) : null}
          {show.entries ? (
            <StatTile href="/admin/tasks" label="Awaiting approval" testId="tile-awaiting">
              <span className="flex flex-wrap items-baseline gap-x-3.5">
                <span className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[28px] font-semibold leading-[36px]">{dash(data.awaiting?.inspections)}</span>
                  <span className="text-small text-fg-muted">Inspections</span>
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[28px] font-semibold leading-[36px]">{dash(data.awaiting?.storeRoom)}</span>
                  <span className="text-small text-fg-muted">Store Room</span>
                </span>
              </span>
            </StatTile>
          ) : null}
          {show.xero ? <XeroHealthTile health={data.xero} /> : null}
        </section>
      ) : (
        <EmptyState icon="home" title="Nothing to show here" body="Your role has no forms or tasks. Use the menu to find your work." />
      )}

      {hasLeft || hasRight ? (
        <div className="flex flex-wrap items-start gap-5">
          {hasLeft ? (
            <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-5">
              {show.tasks ? <MyTasksCard rows={tasks?.rows ?? null} /> : null}
              {show.entries ? <RecentEntriesCard rows={data.recent} /> : null}
            </div>
          ) : null}
          {hasRight ? (
            <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-5">
              {show.entries && data.forms ? <FormsCard forms={data.forms} /> : null}
              {show.xero && data.xero ? <SyncByEntityCard rows={data.xero.sync} /> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
