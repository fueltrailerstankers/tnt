import { EmptyState } from '@/components/ui/EmptyState';
import { FilterChips } from '@/components/ui/FilterChips';
import { Pagination } from '@/components/ui/Pagination';
import { StatusChip } from '@/components/ui/StatusChip';
import { tableClass, tableWrapClass, theadClass } from '@/components/ui/styles';
import { SettingsTabs } from '@/components/users/SettingsTabs';
import { requirePerm } from '@/lib/security/require';
import { JOB_PAGE_SIZE, JOB_STATES, jobRunView, parseJobState, parsePage, type JobRunRow, type JobStateFilter } from '@/lib/settings/job-runs';
import { createAdminClient } from '@/lib/supabase/admin';
import { pageCount } from '@/lib/ui/pagination';
import { dayTime } from '@/lib/ui/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Job runs · Trailers & Tankers' };

const href = (state: JobStateFilter, page = 1) => {
  const q = new URLSearchParams();
  if (state !== 'all') q.set('state', state);
  if (page > 1) q.set('page', String(page));
  const s = q.toString();
  return `/admin/settings/jobs${s ? `?${s}` : ''}`;
};

export default async function JobRuns({ searchParams }: { searchParams: Promise<{ state?: string; page?: string }> }) {
  const member = await requirePerm('settings.read');
  const sp = await searchParams;
  const state = parseJobState(sp.state);
  const page = parsePage(sp.page);
  const now = Date.now();
  // job_runs is service-only (no client grants): read after the permission check, this org's runs plus the
  // org-less scheduler runs (outbox drain, import drain), ids and counts only.
  const db = createAdminClient();
  let q = db.from('job_runs').select('id, job, started_at, finished_at, ok, processed, error', { count: 'exact' })
    .or(`org_id.eq.${member.orgId},org_id.is.null`);
  if (state === 'failed') q = q.eq('ok', false);
  else if (state === 'succeeded') q = q.eq('ok', true);
  else if (state === 'running') q = q.is('ok', null);
  const from = (page - 1) * JOB_PAGE_SIZE;
  const { data, count, error } = await q.order('started_at', { ascending: false }).order('id', { ascending: false }).range(from, from + JOB_PAGE_SIZE - 1);
  const rows = error ? [] : ((data ?? []) as JobRunRow[]).map((r) => jobRunView(r, now));
  const total = error ? 0 : count ?? 0;
  const pages = pageCount(total, JOB_PAGE_SIZE);

  return (
    <section className="flex w-full min-w-0 max-w-[1360px] flex-col gap-4">
      <h1 className="text-h1">Settings</h1>
      <SettingsTabs member={member} current="jobs" />
      <FilterChips label="Filter by state" value={state} size="md" chips={JOB_STATES.map((s) => ({ value: s.value, label: s.label, href: href(s.value) }))} />
      <div className={tableWrapClass}>
        {rows.length ? (
          <table className={`${tableClass} min-w-[760px]`} data-testid="job-runs">
            <thead className={theadClass}>
              <tr><th className="px-4 py-2.5">Run</th><th className="p-2.5">Job</th><th className="p-2.5">Started (SAST)</th><th className="p-2.5">Duration</th><th className="p-2.5 text-right">Processed</th><th className="py-2.5 pl-2.5 pr-4">State</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="h-[42px] border-t border-border" data-testid={`job-run-${r.id.slice(1)}`}>
                  <td className="px-4 font-mono text-small">{r.id}</td>
                  <td className="px-2.5 font-mono text-small">{r.job}</td>
                  <td className="whitespace-nowrap px-2.5 text-fg-muted">{dayTime(r.startedAt, now)}</td>
                  <td className="whitespace-nowrap px-2.5 text-fg-muted">{r.duration}</td>
                  <td className="px-2.5 text-right font-mono tabular-nums">{r.processed}</td>
                  <td className="py-1.5 pl-2.5 pr-4">
                    <StatusChip status={r.state} color={r.tone} size="sm" />
                    {r.error ? <span className="ml-2 text-small text-status-red-fg">{r.error}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState variant="plain" icon="job" title={state === 'all' ? 'No job runs yet' : 'No runs match this filter'} body="Scheduled syncs, the outbox and imports record a row here each time they run." />
        )}
        <Pagination footer page={Math.min(page, pages)} pageCount={pages} total={total} pageSize={JOB_PAGE_SIZE}
          prevHref={page > 1 ? href(state, page - 1) : undefined} nextHref={page < pages ? href(state, page + 1) : undefined} />
      </div>
    </section>
  );
}
