import Link from 'next/link';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterChips, type FilterChip } from '@/components/ui/FilterChips';
import { Icon } from '@/components/ui/Icon';
import { inboxQuery, type InboxData } from '@/lib/leads-view/load';
import { ageLabel, ageWords, INBOX_VIEW_LABEL, PHONE_VIEWS, STATUS_LABEL, STATUS_TONE, type InboxView } from '@/lib/leads-view/model';
import { DuplicateTag, LeadStatusChip, SourceTag } from './LeadBits';

const DOT = { teal: 'teal', yellow: 'yellow', accent: 'yellow', green: 'green', gray: 'gray', red: 'red' } as const;

/** Lead list (inbox left column; the whole page on phones until a lead is opened). */
export function LeadList({ data, selectedId, now, className = '' }: { data: InboxData; selectedId: string | null; now: Date; className?: string }) {
  const { params, counts } = data;
  const open = counts.new + counts.contacted + counts.quoted;
  const desktopViews: InboxView[] = ['open', 'mine', 'won', 'lost', ...(counts.spam || data.active === 'spam' ? ['spam' as const] : []), 'all'];
  const viewCount: Record<string, number | undefined> = { open, mine: counts.mine, won: counts.won, lost: counts.lost, spam: counts.spam };
  const desktopChips: FilterChip[] = desktopViews.map((v) => ({
    value: v, label: INBOX_VIEW_LABEL[v], count: viewCount[v], href: `/admin/leads${inboxQuery(params, { view: v, status: null, page: null })}`,
  }));
  const phoneChips: FilterChip[] = PHONE_VIEWS.map((v) => ({
    value: v,
    label: v === 'open' ? 'Open' : STATUS_LABEL[v],
    count: v === 'open' ? open : counts[v],
    dot: v === 'open' ? 'all' : DOT[STATUS_TONE[v]],
    href: `/admin/leads${v === 'open' ? inboxQuery(params, { view: null, status: null, page: null }) : inboxQuery(params, { view: null, status: v, page: null })}`,
  }));
  const rowHref = (id: string) => `/admin/leads/${id}${inboxQuery(params)}`;
  const hidden: Array<[string, string | null]> = [
    ['view', params.view === 'open' ? null : params.view], ['status', params.status], ['source', params.source],
    ['branch', params.branch], ['assigned', params.assigned], ['dups', params.dups ? '1' : null],
  ];

  return (
    <section aria-label="Lead list" className={`min-w-0 overflow-hidden rounded-md border border-border bg-surface shadow-card ${className}`}>
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5">
        <div className="hidden lg:block"><FilterChips label="Filter leads" chips={desktopChips} value={data.active} size="sm" /></div>
        <div className="lg:hidden"><FilterChips label="Stage" chips={phoneChips} value={data.active} size="lg" scroll /></div>
        <form method="get" action="/admin/leads" role="search" className="flex items-center gap-2 rounded-sm border border-border bg-surface-2 px-2.5 focus-within:outline-2 focus-within:outline-focus">
          <Icon name="search" size={14} strokeWidth={2} className="flex-none text-fg-muted" />
          {hidden.map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          <input
            name="q"
            type="search"
            defaultValue={params.q ?? ''}
            aria-label="Search leads"
            placeholder="Name, email, phone or product"
            className="h-9 min-w-0 flex-1 border-0 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle sm:text-small"
          />
        </form>
        <p className="m-0 text-[12px] leading-4 text-fg-muted" aria-live="polite">{data.count} lead{data.count === 1 ? '' : 's'}</p>
      </div>
      {data.rows.length ? (
        <ul className="m-0 list-none p-0">
          {data.rows.map((r) => {
            const cur = r.id === selectedId;
            return (
              <li key={r.id} data-testid="lead-row" className="border-t border-border first:border-t-0">
                <Link
                  href={rowHref(r.id)}
                  aria-current={cur ? 'page' : undefined}
                  className={`flex min-h-[72px] flex-col gap-1 px-3.5 py-3 text-fg no-underline hover:bg-surface-2 ${cur ? 'bg-accent-soft hover:bg-accent-soft' : ''}`}
                >
                  <span className="flex justify-between gap-2">
                    <span className="min-w-0 break-words text-[15px] font-semibold leading-5 lg:text-body">{r.name || '(no name)'}</span>
                    <span className="flex-none text-[12px] leading-5 text-fg-muted">
                      <span aria-hidden="true">{ageLabel(r.created_at, now)}</span>
                      <span className="sr-only">{ageWords(r.created_at, now)}</span>
                    </span>
                  </span>
                  {r.product ? <span className="text-small text-fg-muted">{r.product}</span> : null}
                  <span className="flex flex-wrap items-center gap-1.5">
                    <LeadStatusChip status={r.status} />
                    <SourceTag source={r.source} names={data.sources} />
                    {r.duplicate_of ? <DuplicateTag /> : null}
                    {r.matched_quote_number ? <span className="font-mono text-[11px] font-semibold text-fg-muted">{r.matched_quote_number}</span> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState variant="plain" icon="leads" title="No leads here" body={params.q ? 'Nothing matches that search.' : 'New leads from the website, test webhooks and Add lead appear here.'} />
      )}
      {data.pages > 1 ? (
        <nav aria-label="Lead pages" className="flex items-center justify-between gap-2 border-t border-border px-3.5 py-2.5 text-small">
          {params.page > 1 ? <Link href={`/admin/leads${inboxQuery(params, { page: String(params.page - 1) })}`} className="font-semibold text-accent-text">Previous</Link> : <span />}
          <span className="text-fg-muted">Page {params.page} of {data.pages}</span>
          {params.page < data.pages ? <Link href={`/admin/leads${inboxQuery(params, { page: String(params.page + 1) })}`} className="font-semibold text-accent-text">Next</Link> : <span />}
        </nav>
      ) : null}
    </section>
  );
}
