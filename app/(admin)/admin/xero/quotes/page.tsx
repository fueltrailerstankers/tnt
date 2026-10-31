import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { StatusChip } from '@/components/ui/StatusChip';
import { Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { ZarAmount } from '@/components/ui/ZarAmount';
import { MirrorDrawer } from '@/components/xero-mirror/MirrorDrawer';
import { MirrorHeader } from '@/components/xero-mirror/MirrorHeader';
import { MirrorToolbar } from '@/components/xero-mirror/MirrorToolbar';
import { Facts, Lines, RecordFooter, Section, Totals } from '@/components/xero-mirror/RecordParts';
import { MIRROR_PAGE, mirrorHref, parseMirrorQuery, QUOTE_STATUSES, statusLabel, xeroLink } from '@/lib/admin/mirror';
import { loadFxRate } from '@/lib/deal-view/fx-server';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { dayTime, shortDate } from '@/lib/ui/time';
import { toneFor } from '@/lib/ui/status';
import { listQuotes, mirrorHeader, quoteDetail } from '../_lib/load';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quotes · Trailers & Tankers' };

/** Read-only Xero quotes. ?q= search, ?status= filter, ?page=, ?id= opens the drawer (Back closes it). */
export default async function Quotes({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requirePerm('quotes.read');
  const s = parseMirrorQuery('quotes', await searchParams);
  const db = await createClient();
  const now = new Date().toISOString();
  const [{ rows, count }, header, detail, fxRate] = await Promise.all([
    listQuotes(db, member.orgId, s),
    mirrorHeader(db, member, 'quotes'),
    s.id ? quoteDetail(db, member, s.id) : null,
    loadFxRate(member.orgId),
  ]);
  const pages = Math.max(1, Math.ceil(count / MIRROR_PAGE));
  const listHref = mirrorHref('quotes', s, { id: null });
  const chips = [
    { value: '', label: 'All', href: mirrorHref('quotes', s, { status: null, page: 1, id: null }) },
    ...QUOTE_STATUSES.map((st) => ({ value: st, label: statusLabel(st), dot: toneFor(statusLabel(st)), href: mirrorHref('quotes', s, { status: st, page: 1, id: null }) })),
  ];

  return (
    <section className="flex flex-col gap-4">
      <MirrorHeader
        kind="quotes"
        quoteCount={header.quoteCount}
        invoiceCount={header.invoiceCount}
        syncedAt={header.syncedAt}
        syncFailed={header.syncFailed}
        now={now}
        healthHref={can(member, 'integrations.read') ? '/admin/integrations/xero' : null}
      />
      {s.id && !detail ? (
        <p role="status" className="m-0 rounded-sm bg-status-yellow-bg px-3 py-2 text-small text-status-yellow-fg">That quote is not in the mirror.</p>
      ) : null}

      <Card padding="none">
        <MirrorToolbar
          action="/admin/xero/quotes"
          searchLabel="Search quotes"
          q={s.q}
          placeholder="Number, contact or reference"
          hidden={{ status: s.status }}
          statusChips={chips}
          status={s.status ?? ''}
        />
        <TableWrap label="Quotes">
          <Table minWidth={820} data-testid="quotes-table">
            <THead>
              <tr>
                <TH>Number</TH><TH>Contact</TH><TH>Date</TH><TH>Expiry</TH><TH>Status</TH><TH numeric>Total</TH><TH>Synced</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.quote_id} selected={r.quote_id === s.id}>
                  <TD>
                    <Link
                      href={mirrorHref('quotes', s, { id: r.quote_id })}
                      scroll={false}
                      aria-current={r.quote_id === s.id ? 'true' : undefined}
                      className="font-mono text-small font-semibold text-accent-text no-underline hover:underline"
                    >
                      {r.quote_number || '(no number)'}
                    </Link>
                  </TD>
                  <TD>{r.contact_name}</TD>
                  <TD muted>{shortDate(r.quote_date)}</TD>
                  <TD muted>{shortDate(r.expiry_date)}</TD>
                  <TD><StatusChip status={statusLabel(r.status)} /></TD>
                  <TD numeric><ZarAmount amount={r.total} currency={r.currency_code} align="end" /></TD>
                  <TD muted className="text-small">{dayTime(r.synced_at, now)}</TD>
                </TR>
              ))}
              {!rows.length ? (
                <TableEmpty colSpan={7}>
                  <EmptyState variant="plain" icon="quotes" title="No quotes" body={s.q || s.status ? 'Nothing matches this search or filter.' : 'Nothing has been mirrored from Xero yet.'} />
                </TableEmpty>
              ) : null}
            </TBody>
          </Table>
        </TableWrap>
        <Pagination
          page={s.page}
          pageCount={pages}
          total={count}
          pageSize={MIRROR_PAGE}
          prevHref={s.page > 1 ? mirrorHref('quotes', s, { page: s.page - 1, id: null }) : undefined}
          nextHref={s.page < pages ? mirrorHref('quotes', s, { page: s.page + 1, id: null }) : undefined}
        />
      </Card>

      {detail ? (
        <MirrorDrawer
          closeHref={listHref}
          eyebrow="Quote · Xero"
          title={detail.quote.quote_number || '(no number)'}
          meta={<><StatusChip status={statusLabel(detail.quote.status)} /><span>{detail.quote.contact_name}</span></>}
          footer={<RecordFooter
            xeroHref={xeroLink('quote', detail.quote.quote_id)}
            dealHref={detail.dealQuoteNo ? `/admin/deal-files/${encodeURIComponent(detail.dealQuoteNo)}` : null}
          />}
        >
          <Facts items={[
            { term: 'Date', value: shortDate(detail.quote.quote_date) || '—' },
            { term: 'Expiry', value: shortDate(detail.quote.expiry_date) || '—' },
            { term: 'Reference', value: detail.quote.reference || '—', mono: true },
            {
              term: 'Linked deal',
              value: detail.dealQuoteNo
                ? <Link href={`/admin/deal-files/${encodeURIComponent(detail.dealQuoteNo)}`} className="font-semibold text-accent-text">Deal file</Link>
                : can(member, 'deals.read') ? 'None yet' : '—',
            },
          ]} />
          <div className="flex flex-col gap-0">
            <Lines lines={detail.lines} currency={detail.quote.currency_code} />
            <Totals subTotal={detail.quote.sub_total} totalTax={detail.quote.total_tax} total={detail.quote.total} currency={detail.quote.currency_code} fxRate={fxRate} />
          </div>
          <Section title="Attachments" id="mirror-attachments">
            <p className="m-0 text-small text-fg-muted">Quote attachments are not mirrored. Open the quote in Xero to see them.</p>
          </Section>
          <p className="m-0 text-small text-fg-muted">Synced {dayTime(detail.quote.synced_at, now)} SAST. Read only: change it in Xero.</p>
        </MirrorDrawer>
      ) : null}
    </section>
  );
}
