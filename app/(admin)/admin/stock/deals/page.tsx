import Link from 'next/link';
import { Label, Select } from '@/components/ui/Field';
import { StatusChip } from '@/components/ui/StatusChip';
import { buttonClass, cardClass } from '@/components/ui/styles';
import { formatDateTime } from '@/lib/admin/grid';
import { loadOrg } from '@/lib/forms/org';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { todayIn } from '@/lib/spec/values';
import { DEALS_FROM_KEY, parseDealsFrom, type DealStatus } from '@/lib/stock/deal-sync';
import {
  clampPage, DEAL_STATUS_LABEL, DEAL_STATUS_TONE, DEALS_COPY, DEALS_PAGE_SIZE, dealsHref, outstandingFooter, pageCount, parseDealsQuery, permissionLine, yearOptions,
} from '@/lib/stock/deals-view';
import { dispatchHref } from '@/lib/stock/dispatch';
import { STOCK_COPY } from '@/lib/stock/errors';
import { loadDismissalHistory, loadLocations, locationNamer } from '@/lib/stock/lookup';
import { createClient } from '@/lib/supabase/server';
import { DismissButton, RestoreButton } from './deal-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Deals · Stock · Trailers & Tankers' };

interface DealRow {
  id: string;
  entry_id: string | null;
  year: number;
  number: number;
  location_id: string | null;
  model_part: string | null;
  quote_number: string | null;
  status: DealStatus;
  dismissed_reason: string | null;
  created_at: string;
}

// Responsive table: a card per deal on phones (labels from data-label), a table from md up. One DOM for both.
const tdClass = 'flex items-baseline justify-between gap-3 py-1 text-right before:shrink-0 before:text-small before:font-semibold before:text-fg-muted before:content-[attr(data-label)] md:table-cell md:p-3 md:text-left md:align-middle md:before:content-none';

/** Deals awaiting dispatch (stock plan 7.2). Every read goes through the caller's RLS (stock.read roles). */
export default async function StockDeals({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requirePerm('stock.read');
  const sp = await searchParams;
  const db = await createClient();
  const [locations, org, setting] = await Promise.all([
    loadLocations(db, member.orgId),
    loadOrg(db, member.orgId),
    db.from('app_settings').select('value').eq('org_id', member.orgId).eq('key', DEALS_FROM_KEY).maybeSingle(),
  ]);
  const branches = locations.filter((l) => !l.is_factory);
  const nameOf = locationNamer(locations);
  const currentYear = Number(todayIn(org.timezone).slice(0, 4));
  const q = parseDealsQuery(sp, currentYear, branches.map((b) => b.id));
  const dealsFrom = parseDealsFrom(setting.data?.value);
  const canManage = can(member, 'stock.manage');
  const canDispatch = can(member, 'stock.dispatch');
  const canOpenEntry = can(member, 'entries.read');

  const outstanding = (branch: string | null) => {
    let c = db.from('stock_deals').select('id', { count: 'exact', head: true })
      .eq('org_id', member.orgId).eq('year', q.year).eq('status', 'awaiting_dispatch');
    if (branch) c = c.eq('location_id', branch);
    return c;
  };
  const listStatus = q.dismissed ? 'dismissed' : 'awaiting_dispatch';
  let listCount = db.from('stock_deals').select('id', { count: 'exact', head: true })
    .eq('org_id', member.orgId).eq('year', q.year).eq('status', listStatus);
  if (q.branch) listCount = listCount.eq('location_id', q.branch);
  const yearEnd = (ascending: boolean) => db.from('stock_deals').select('year').eq('org_id', member.orgId).order('year', { ascending }).limit(1);

  const [all, perBranch, listed, oldest, newest, history] = await Promise.all([
    outstanding(null),
    Promise.all(branches.map((b) => outstanding(b.id))),
    listCount,
    yearEnd(true),
    yearEnd(false),
    loadDismissalHistory(db, member.orgId, 10),
  ]);
  if (all.error || listed.error || perBranch.some((r) => r.error)) throw new Error('stock deals unreadable');

  // A page past the end (old link, rows dismissed meanwhile) shows the last page instead of a range error.
  const total = listed.count ?? 0;
  const pages = pageCount(total);
  const view = { ...q, page: clampPage(q.page, total) };
  let list = db.from('stock_deals')
    .select('id, entry_id, year, number, location_id, model_part, quote_number, status, dismissed_reason, created_at')
    .eq('org_id', member.orgId).eq('year', q.year).eq('status', listStatus)
    .order('number', { ascending: false })
    .range((view.page - 1) * DEALS_PAGE_SIZE, view.page * DEALS_PAGE_SIZE - 1);
  if (q.branch) list = list.eq('location_id', q.branch);
  const rows = await list;
  if (rows.error) throw new Error('stock deals unreadable');

  const counts = new Map(branches.map((b, i) => [b.id, perBranch[i].count ?? 0]));
  const deals = (rows.data ?? []) as DealRow[];
  const years = yearOptions(oldest.data?.[0]?.year ?? null, newest.data?.[0]?.year ?? null, currentYear, q.year);
  const footerCount = q.branch ? counts.get(q.branch) ?? 0 : all.count ?? 0;
  const kpis = [{ id: null as string | null, label: DEALS_COPY.allBranches, value: all.count ?? 0 }, ...branches.map((b) => ({ id: b.id as string | null, label: b.name, value: counts.get(b.id) ?? 0 }))];

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-label uppercase text-accent-text">{DEALS_COPY.eyebrow}</p>
          <h1 className="text-h1">{DEALS_COPY.title}</h1>
          <p className="text-body text-fg-muted">{permissionLine(canManage)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={dealsFrom ? DEALS_COPY.importFrom(dealsFrom) : DEALS_COPY.importOff} color={dealsFrom ? 'teal' : 'gray'} />
          {/* A plain link: a full reload of the same view re-reads deals and the dismissal history. */}
          <a href={dealsHref(view, currentYear)} className={buttonClass('secondary', 36)}>{DEALS_COPY.refresh}</a>
        </div>
      </header>

      <p className="rounded-sm border border-border bg-surface-2 p-3 text-body text-fg">{STOCK_COPY.dealClearsNote}</p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <Link
            key={k.id ?? 'all'}
            href={dealsHref(q, currentYear, { branch: k.id, dismissed: false, page: 1 })}
            data-testid={`deals-kpi-${k.id ?? 'all'}`}
            aria-current={q.branch === k.id && !q.dismissed ? 'true' : undefined}
            className={`${cardClass} block p-4 text-fg no-underline hover:border-border-strong aria-[current=true]:border-accent`}
          >
            <span className="block text-small font-semibold text-fg-muted">{k.label}</span>
            <span className="block text-display tabular-nums">{k.value}</span>
            <span className="block text-small text-fg-muted">{DEALS_COPY.kpiSub(q.year)}</span>
          </Link>
        ))}
      </div>

      <div className={cardClass}>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="text-h2">{q.dismissed ? DEALS_COPY.dismissedTitle : DEALS_COPY.tableTitle}</h2>
            <p className="text-small text-fg-muted">{q.dismissed ? DEALS_COPY.dismissedHint : DEALS_COPY.tableHint}</p>
          </div>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="deals-year">Year</Label>
              <Select id="deals-year" name="year" defaultValue={String(q.year)} className="w-28">
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="deals-branch">Branch</Label>
              <Select id="deals-branch" name="branch" defaultValue={q.branch ?? ''} className="w-44">
                <option value="">{DEALS_COPY.allBranches}</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </div>
            <label className="flex h-11 items-center gap-2 text-body font-semibold">
              <input type="checkbox" name="dismissed" value="1" defaultChecked={q.dismissed} className="size-4 accent-accent" />
              {DEALS_COPY.showDismissed}
            </label>
            <button className={buttonClass('primary', 44)}>Apply</button>
          </form>
        </div>

        <table className="w-full border-collapse text-body">
          <thead className="hidden bg-surface-2 text-left text-label text-fg-muted md:table-header-group">
            <tr>
              <th className="p-3">YEAR / DEAL</th><th className="p-3">BRANCH</th><th className="p-3">MODEL</th><th className="p-3">QUOTE NUMBER</th>
              <th className="p-3">STATUS</th><th className="p-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d) => {
              const label = `${d.year} / ${d.number}`;
              return (
                <tr key={d.id} data-testid="deal-row" data-deal={label} className="block border-t border-border px-4 py-3 md:table-row md:p-0">
                  <td data-label="Year / deal" className={tdClass}>
                    <span>
                      {canOpenEntry && d.entry_id
                        ? <Link href={`/admin/forms/deal/entries/${d.number}`} className="font-semibold">{label}</Link>
                        : <span className="font-semibold">{label}</span>}
                      <span className="block text-small text-fg-muted">Added {formatDateTime(d.created_at, org.timezone).slice(0, 10)}</span>
                    </span>
                  </td>
                  <td data-label="Branch" className={tdClass}>{d.location_id ? nameOf(d.location_id) ?? d.location_id : <span className="text-fg-muted">{DEALS_COPY.noBranch}</span>}</td>
                  <td data-label="Model" className={tdClass}>
                    {d.model_part ? <span className="font-mono text-small">{d.model_part}</span> : <StatusChip status={STOCK_COPY.modelNotRecognised} color="yellow" size="sm" />}
                  </td>
                  <td data-label="Quote number" className={tdClass}>{d.quote_number ?? '—'}</td>
                  <td data-label="Status" className={tdClass}>
                    <span className="flex flex-col items-end gap-0.5 md:items-start">
                      <StatusChip status={DEAL_STATUS_LABEL[d.status]} color={DEAL_STATUS_TONE[d.status]} size="sm" />
                      {d.status === 'dismissed' && d.dismissed_reason ? <span className="text-small text-fg-muted" data-testid="dismissed-reason">{d.dismissed_reason}</span> : null}
                    </span>
                  </td>
                  <td className="flex flex-wrap justify-end gap-2 pt-2 md:table-cell md:p-3 md:text-right">
                    <span className="inline-flex flex-wrap items-center justify-end gap-2">
                      {d.status === 'awaiting_dispatch' && canDispatch
                        ? <Link href={dispatchHref(d.year, d.number)} className={buttonClass('primary', 36)} aria-label={`Dispatch deal ${label}`}>{DEALS_COPY.dispatch}</Link>
                        : null}
                      {d.status === 'awaiting_dispatch' && canManage ? <DismissButton dealId={d.id} year={d.year} number={d.number} /> : null}
                      {d.status === 'dismissed' && canManage ? <RestoreButton dealId={d.id} year={d.year} number={d.number} /> : null}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!deals.length ? (
              <tr className="block md:table-row"><td colSpan={6} className="block p-6 text-center text-fg-muted md:table-cell">{q.dismissed ? DEALS_COPY.emptyDismissed : DEALS_COPY.empty}</td></tr>
            ) : null}
          </tbody>
        </table>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4 text-small text-fg-muted">
          <span data-testid="deals-footer">{outstandingFooter(footerCount)}</span>
          {pages > 1 || view.page > 1 ? (
            <span className="flex items-center gap-3">
              {view.page > 1 ? <Link href={dealsHref(view, currentYear, { page: view.page - 1 })}>Previous</Link> : null}
              <span data-testid="deals-page">Page {view.page} of {pages}</span>
              {view.page < pages ? <Link href={dealsHref(view, currentYear, { page: view.page + 1 })}>Next</Link> : null}
            </span>
          ) : null}
        </div>
      </div>

      <div className={cardClass}>
        <div className="border-b border-border p-4">
          <h2 className="text-h2">Dismissal history</h2>
          <p className="text-small text-fg-muted">Every dismissal keeps its reason, also after the deal is restored.</p>
        </div>
        {history.length ? (
          <ul className="divide-y divide-border" data-testid="dismissal-history">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 p-4">
                <span className="min-w-0">
                  <span className="font-semibold">{h.deal ? `${h.deal.year} / ${h.deal.number}` : 'Deal'}</span>
                  <span className="text-fg-muted"> · {h.reason}</span>
                </span>
                <span className="flex items-center gap-2 text-small text-fg-muted">
                  {formatDateTime(h.dismissedAt, org.timezone)}{h.by ? ` · ${h.by}` : ''}
                  {h.deal ? <StatusChip status={h.deal.status === 'dismissed' ? 'Dismissed' : h.deal.status === 'dispatched' ? 'Dispatched' : 'Restored'} color={h.deal.status === 'dismissed' ? 'gray' : h.deal.status === 'dispatched' ? 'green' : 'yellow'} size="sm" /> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="p-4 text-body text-fg-muted">No deals have been dismissed.</p>}
      </div>
    </section>
  );
}
