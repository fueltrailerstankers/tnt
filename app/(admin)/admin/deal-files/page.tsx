import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Pagination } from '@/components/ui/Pagination';
import { buttonClass } from '@/components/ui/styles';
import { Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { MIRROR_PAGE, pageOf } from '@/lib/admin/mirror';
import { JOURNEY } from '@/lib/deal-view/journey';
import { dealSearchTerm, quoteLabel } from '@/lib/deal-view/search';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { dayTime } from '@/lib/ui/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Deal files · Trailers & Tankers' };

/** Deal files, newest activity first. ?q= matches quote no ("QU-10482" or "10482"), VIN or customer. */
export default async function DealFiles({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requirePerm('deals.read');
  const sp = await searchParams;
  const q = dealSearchTerm(sp.q);
  const page = pageOf(sp.page);
  const db = await createClient();
  let query = db.from('deal_files')
    .select('id, quote_no, customer_name, vin, branch, rep, invoice_numbers, updated_at, deal_entry_id, rfi_entry_id, job_card_entry_id, inspection_entry_id, release_entry_id, delivery_entry_id', { count: 'exact' })
    .eq('org_id', member.orgId).order('updated_at', { ascending: false }).order('quote_no', { ascending: false })
    .range((page - 1) * MIRROR_PAGE, page * MIRROR_PAGE - 1);
  if (q) query = query.or(`quote_no.ilike.*${q}*,vin.ilike.*${q}*,customer_name.ilike.*${q}*`);
  const { data, count } = await query;
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / MIRROR_PAGE));
  const href = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set('q', q);
    if (p > 1) u.set('page', String(p));
    return `/admin/deal-files${u.size ? `?${u}` : ''}`;
  };
  const now = new Date().toISOString();

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-h1">Deal files</h1>
        <p className="m-0 text-small text-fg-muted">One per trailer, from deal to delivery. Newest activity first.</p>
      </div>
      <Card padding="none">
        <div className="border-b border-border px-3.5 py-3">
          <form method="get" action="/admin/deal-files" role="search" aria-label="Search deal files" className="flex max-w-[460px] items-center gap-2">
            <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-sm border border-border-strong bg-surface-2 px-2.5 text-fg-muted focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/25">
              <Icon name="search" size={14} strokeWidth={2} />
              <span className="sr-only">Search quote no, VIN or customer</span>
              <input
                type="search"
                name="q"
                defaultValue={q ?? ''}
                placeholder="Quote no, VIN or customer"
                className="min-w-0 flex-1 border-0 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle sm:text-small"
              />
            </label>
            <button type="submit" className={buttonClass('secondary', 36)}>Search</button>
          </form>
        </div>
        <TableWrap label="Deal files">
          <Table minWidth={960} data-testid="deal-files-table">
            <THead>
              <tr>
                <TH>Quote</TH><TH>Customer</TH><TH>VIN</TH><TH>Branch</TH><TH>Rep</TH><TH>Invoices</TH><TH>Journey</TH><TH>Updated</TH>
              </tr>
            </THead>
            <TBody>
              {(data ?? []).map((r) => {
                const done = JOURNEY.filter((s) => !!r[s.field]).length;
                return (
                  <TR key={r.id}>
                    <TD>
                      <Link href={`/admin/deal-files/${encodeURIComponent(r.quote_no)}`} className="whitespace-nowrap font-mono text-small font-semibold text-accent-text no-underline hover:underline">
                        {quoteLabel(r.quote_no)}
                      </Link>
                    </TD>
                    <TD>{r.customer_name}</TD>
                    <TD mono className="whitespace-nowrap">{r.vin}</TD>
                    <TD>{r.branch}</TD>
                    <TD>{r.rep}</TD>
                    <TD mono>{(r.invoice_numbers ?? []).join(', ')}</TD>
                    <TD>
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <span className="sr-only">{`${done} of ${JOURNEY.length} linked: `}</span>
                        <span aria-hidden="true" className="inline-flex gap-1">
                          {JOURNEY.map((s) => (
                            <span
                              key={s.key}
                              title={`${s.label}: ${r[s.field] ? 'linked' : 'not yet'}`}
                              className={`flex size-5 items-center justify-center rounded-full text-[10px] font-bold ${r[s.field] ? 'bg-status-green-fg text-surface' : 'border border-border-strong text-fg-muted'}`}
                            >
                              {r[s.field] ? <Icon name="check" size={12} strokeWidth={3} /> : s.label[0]}
                            </span>
                          ))}
                        </span>
                        <span className="sr-only">{JOURNEY.filter((s) => !!r[s.field]).map((s) => s.label).join(', ') || 'none'}</span>
                        <span aria-hidden="true" className="text-small text-fg-muted">{done}/{JOURNEY.length}</span>
                      </span>
                    </TD>
                    <TD muted className="text-small">{dayTime(r.updated_at, now)}</TD>
                  </TR>
                );
              })}
              {!data?.length ? (
                <TableEmpty colSpan={8}>
                  <EmptyState variant="plain" icon="deals" title="No deal files" body={q ? 'Nothing matches this search.' : 'Deal files appear after the nightly Xero sync links quotes and forms.'} />
                </TableEmpty>
              ) : null}
            </TBody>
          </Table>
        </TableWrap>
        <Pagination
          page={page}
          pageCount={pages}
          total={total}
          pageSize={MIRROR_PAGE}
          prevHref={page > 1 ? href(page - 1) : undefined}
          nextHref={page < pages ? href(page + 1) : undefined}
        />
      </Card>
    </section>
  );
}
