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
import {
  fileSize, INVOICE_FILTERS, INVOICE_TYPES, invoiceStatusLabel, MIRROR_PAGE, mirrorHref, parseMirrorQuery, sastToday, statusLabel, xeroLink,
  type InvoiceType,
} from '@/lib/admin/mirror';
import { loadFxRate } from '@/lib/deal-view/fx-server';
import { formatAmount } from '@/lib/money/fx';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { toneFor } from '@/lib/ui/status';
import { dayTime, shortDate } from '@/lib/ui/time';
import { invoiceDetail, listInvoices, mirrorHeader } from '../_lib/load';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invoices · Trailers & Tankers' };

const TYPE_LABEL: Record<InvoiceType, string> = { ACCREC: 'Sales', ACCPAY: 'Bills', ALL: 'All' };

/** Read-only Xero invoices. ?q= search, ?status= (incl. OVERDUE), ?type=, ?page=, ?id= opens the drawer (Back closes it). */
export default async function Invoices({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requirePerm('invoices.read');
  const s = parseMirrorQuery('invoices', await searchParams);
  const db = await createClient();
  const now = new Date().toISOString();
  const today = sastToday(now);
  const [{ rows, count }, header, detail, fxRate] = await Promise.all([
    listInvoices(db, member.orgId, s, today),
    mirrorHeader(db, member, 'invoices'),
    s.id ? invoiceDetail(db, member, s.id) : null,
    loadFxRate(member.orgId),
  ]);
  const pages = Math.max(1, Math.ceil(count / MIRROR_PAGE));
  const listHref = mirrorHref('invoices', s, { id: null });
  const statusChips = [
    { value: '', label: 'All', href: mirrorHref('invoices', s, { status: null, page: 1, id: null }) },
    ...INVOICE_FILTERS.map((st) => {
      const label = st === 'OVERDUE' ? 'Overdue' : statusLabel(st);
      return { value: st, label, dot: toneFor(label), href: mirrorHref('invoices', s, { status: st, page: 1, id: null }) };
    }),
  ];
  const typeChips = INVOICE_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t], href: mirrorHref('invoices', s, { type: t, page: 1, id: null }) }));
  const contactHead = s.type === 'ACCPAY' ? 'Supplier' : s.type === 'ALL' ? 'Contact' : 'Customer';
  const noun = s.type === 'ACCPAY' ? 'bills' : 'invoices';

  const inv = detail?.invoice;
  const dealHref = detail?.dealQuoteNo ? `/admin/deal-files/${encodeURIComponent(detail.dealQuoteNo)}` : null;

  return (
    <section className="flex flex-col gap-4">
      <MirrorHeader
        kind="invoices"
        quoteCount={header.quoteCount}
        invoiceCount={header.invoiceCount}
        syncedAt={header.syncedAt}
        syncFailed={header.syncFailed}
        now={now}
        healthHref={can(member, 'integrations.read') ? '/admin/integrations/xero' : null}
      />
      {s.id && !detail ? (
        <p role="status" className="m-0 rounded-sm bg-status-yellow-bg px-3 py-2 text-small text-status-yellow-fg">That invoice is not in the mirror.</p>
      ) : null}

      <Card padding="none">
        <MirrorToolbar
          action="/admin/xero/invoices"
          searchLabel="Search invoices"
          q={s.q}
          placeholder="Number, contact or reference"
          hidden={{ status: s.status, type: s.type === 'ACCREC' ? null : s.type }}
          statusChips={statusChips}
          status={s.status ?? ''}
          typeChips={typeChips}
          type={s.type}
        />
        <TableWrap label="Invoices">
          <Table minWidth={860} data-testid="invoices-table">
            <THead>
              <tr>
                <TH>Number</TH><TH>{contactHead}</TH><TH>Date</TH><TH>Due</TH><TH>Status</TH><TH numeric>Total</TH><TH numeric>Amount due</TH><TH>Synced</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.invoice_id} selected={r.invoice_id === s.id}>
                  <TD>
                    <Link
                      href={mirrorHref('invoices', s, { id: r.invoice_id })}
                      scroll={false}
                      aria-current={r.invoice_id === s.id ? 'true' : undefined}
                      className="whitespace-nowrap font-mono text-small font-semibold text-accent-text no-underline hover:underline"
                    >
                      {r.invoice_number || '(no number)'}
                    </Link>
                  </TD>
                  <TD>{r.contact_name}</TD>
                  <TD muted>{shortDate(r.invoice_date)}</TD>
                  <TD muted>{shortDate(r.due_date)}</TD>
                  <TD><StatusChip status={invoiceStatusLabel(r, today)} /></TD>
                  <TD numeric><ZarAmount amount={r.total} currency={r.currency_code} align="end" /></TD>
                  <TD numeric><ZarAmount amount={r.amount_due} currency={r.currency_code} align="end" /></TD>
                  <TD muted className="text-small">{dayTime(r.synced_at, now)}</TD>
                </TR>
              ))}
              {!rows.length ? (
                <TableEmpty colSpan={8}>
                  <EmptyState variant="plain" icon="invoices" title={`No ${noun}`} body={s.q || s.status ? 'Nothing matches this search or filter.' : 'Nothing has been mirrored from Xero yet.'} />
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
          prevHref={s.page > 1 ? mirrorHref('invoices', s, { page: s.page - 1, id: null }) : undefined}
          nextHref={s.page < pages ? mirrorHref('invoices', s, { page: s.page + 1, id: null }) : undefined}
        />
      </Card>

      {detail && inv ? (
        <MirrorDrawer
          closeHref={listHref}
          eyebrow={`${inv.invoice_type === 'ACCPAY' ? 'Bill' : 'Invoice'} · Xero`}
          title={inv.invoice_number || '(no number)'}
          meta={<><StatusChip status={invoiceStatusLabel(inv, today)} /><span>{inv.contact_name}</span></>}
          footer={<RecordFooter xeroHref={xeroLink('invoice', inv.invoice_id, inv.invoice_type)} dealHref={dealHref} />}
        >
          <Facts items={[
            { term: 'Date', value: shortDate(inv.invoice_date) || '—' },
            { term: 'Due', value: shortDate(inv.due_date) || '—' },
            { term: 'Reference', value: inv.reference || '—', mono: true },
            {
              term: 'Linked deal',
              value: dealHref
                ? <Link href={dealHref} className="font-semibold text-accent-text">Deal file</Link>
                : can(member, 'deals.read') ? 'None yet' : '—',
            },
            { term: 'Paid on', value: shortDate(inv.fully_paid_on) || '—' },
            { term: 'Type', value: inv.invoice_type === 'ACCPAY' ? 'Bill (ACCPAY)' : inv.invoice_type === 'ACCREC' ? 'Sales (ACCREC)' : inv.invoice_type || '—' },
          ]} />
          <div className="flex flex-col">
            <Lines lines={detail.lines} currency={inv.currency_code} />
            <Totals
              subTotal={inv.sub_total}
              totalTax={inv.total_tax}
              total={inv.total}
              currency={inv.currency_code}
              fxRate={fxRate}
              extra={[
                { label: 'Paid', amount: inv.amount_paid },
                ...(Number(inv.amount_credited) ? [{ label: 'Credited', amount: inv.amount_credited }] : []),
                { label: 'Amount due', amount: inv.amount_due, strong: true },
              ]}
            />
          </div>
          <Section title="Payments" id="mirror-payments">
            {detail.payments.length ? (
              <ul className="m-0 flex list-none flex-col p-0" data-testid="invoice-payments">
                {detail.payments.map((p) => (
                  <li key={p.payment_id} className="flex items-center justify-between gap-3 border-t border-border py-2 text-small">
                    <span className="flex min-w-0 flex-col">
                      <span>{shortDate(p.payment_date) || '—'}</span>
                      <span className="text-fg-muted">{[p.reference, statusLabel(p.status)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="whitespace-nowrap font-mono tabular-nums">{formatAmount(p.amount, p.currency_code ?? inv.currency_code)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="m-0 text-small text-fg-muted">No payments.</p>}
          </Section>
          <Section title="Attachments" id="mirror-attachments">
            {detail.attachments.length ? (
              <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="invoice-attachments">
                {detail.attachments.map((f) => (
                  <li key={f.attachment_id} className="flex items-center gap-2.5 text-small">
                    <span aria-hidden="true" className="flex size-8 flex-none items-center justify-center rounded-sm border border-border bg-surface-2 text-[9px] font-bold text-fg-muted">
                      {(f.mime_type ?? '').includes('pdf') ? 'PDF' : 'FILE'}
                    </span>
                    <span className="min-w-0 flex-1 break-all">{f.file_name}</span>
                    <span className="whitespace-nowrap text-fg-muted">{fileSize(f.content_length)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-small text-fg-muted">
                {inv.has_attachments && !inv.attachments_synced_at ? 'Xero has attachments; their details are not synced yet.' : 'No attachments.'}
              </p>
            )}
            <p className="m-0 text-small text-fg-muted">Attachment details only. Files stay in Xero.</p>
          </Section>
          <p className="m-0 text-small text-fg-muted">Synced {dayTime(inv.synced_at, now)} SAST. Read only: change it in Xero.</p>
        </MirrorDrawer>
      ) : null}
    </section>
  );
}
