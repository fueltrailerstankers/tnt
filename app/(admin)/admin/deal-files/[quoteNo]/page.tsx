import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoney } from '@/lib/admin/format';
import { formatDateTime } from '@/lib/admin/grid';
import { buildTimeline, orderInvoices, QUOTE_NO_PARAM, stageEntryIds, type TimelineEntryRow, type TimelineFormRow } from '@/lib/deal-files/timeline';
import { loadOrg } from '@/lib/forms/org';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Deal file · Trailers & Tankers' };

export default async function DealFilePage({ params }: { params: Promise<{ quoteNo: string }> }) {
  const member = await requirePerm('xero.read');
  const { quoteNo } = await params;
  if (!QUOTE_NO_PARAM.test(quoteNo)) notFound();
  const db = await createClient();
  const [org, { data: file }] = await Promise.all([
    loadOrg(db, member.orgId),
    db.from('deal_files')
      .select('quote_no, quote_id, invoice_ids, vin, customer_name, branch, rep, updated_at, deal_entry_id, rfi_entry_id, job_card_entry_id, inspection_entry_id, release_entry_id, delivery_entry_id')
      .eq('org_id', member.orgId).eq('quote_no', quoteNo).maybeSingle(),
  ]);
  if (!file) notFound();
  const tz = org.timezone;
  const entryIds = stageEntryIds(file);
  const invoiceIds: string[] = file.invoice_ids ?? [];

  const quoteSelect = 'quote_id, quote_number, status, currency_code, total';
  const [{ data: quote }, { data: invoiceRows }, { data: entryRows }, { data: formRows }] = await Promise.all([
    file.quote_id
      ? db.from('xero_quotes').select(quoteSelect).eq('org_id', member.orgId).eq('quote_id', file.quote_id).maybeSingle()
      : db.from('xero_quotes').select(quoteSelect).eq('org_id', member.orgId).eq('quote_no', file.quote_no).limit(1).maybeSingle(),
    invoiceIds.length
      ? db.from('xero_invoices').select('invoice_id, invoice_number, status, currency_code, total, amount_due').eq('org_id', member.orgId).in('invoice_id', invoiceIds)
      : Promise.resolve({ data: [] as Array<{ invoice_id: string; invoice_number: string | null; status: string | null; currency_code: string | null; total: number | null; amount_due: number | null }> }),
    // Metadata only: entry data (encrypted for DEAL and Delivery Note) is never read here.
    entryIds.length
      ? db.from('entries').select('id, number, status, summary, created_at, updated_at, form_id').eq('org_id', member.orgId).in('id', entryIds)
      : Promise.resolve({ data: [] as TimelineEntryRow[] }),
    db.from('forms').select('id, slug, name').eq('org_id', member.orgId),
  ]);
  const invoices = orderInvoices(invoiceIds, invoiceRows ?? []);
  const timeline = buildTimeline(file, (entryRows ?? []) as TimelineEntryRow[], (formRows ?? []) as TimelineFormRow[]);

  return (
    <section className="max-w-4xl space-y-4">
      <p className="text-xs text-neutral-600"><Link href="/admin/deal-files" className="underline">Deal files</Link> / {file.quote_no}</p>
      <h1 className="text-2xl font-semibold">Deal file {file.quote_no}</h1>
      <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-white p-4 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-neutral-600">Customer</dt><dd>{file.customer_name ?? '-'}</dd></div>
        <div><dt className="text-xs text-neutral-600">VIN</dt><dd className="break-all font-mono text-xs">{file.vin ?? '-'}</dd></div>
        <div><dt className="text-xs text-neutral-600">Branch</dt><dd>{file.branch ?? '-'}</dd></div>
        <div><dt className="text-xs text-neutral-600">Rep</dt><dd>{file.rep ?? '-'}</dd></div>
      </dl>

      <ol className="space-y-3" data-testid="deal-timeline">
        <li className="rounded-lg border bg-white p-4 text-sm">
          <h2 className="mb-1 font-semibold">Xero quote</h2>
          {quote ? (
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              <Link href={`/admin/xero/quotes/${quote.quote_id}`} className="underline">{quote.quote_number ?? file.quote_no}</Link>
              <span>{quote.status}</span>
              <span className="tabular-nums">{formatMoney(quote.total, quote.currency_code)}</span>
            </p>
          ) : <p className="text-neutral-600">Not yet</p>}
        </li>

        <li className="rounded-lg border bg-white p-4 text-sm">
          <h2 className="mb-1 font-semibold">Invoices</h2>
          {invoices.length ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="text-left text-xs text-neutral-600"><tr><th className="py-1 pr-2">Invoice</th><th className="py-1 pr-2">Status</th><th className="py-1 pr-2 text-right">Total</th><th className="py-1 text-right">Amount due</th></tr></thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.invoice_id} className="border-t">
                      <td className="py-1 pr-2 whitespace-nowrap"><Link href={`/admin/xero/invoices/${i.invoice_id}`} className="underline">{i.invoice_number || '(no number)'}</Link></td>
                      <td className="py-1 pr-2">{i.status}</td>
                      <td className="py-1 pr-2 text-right tabular-nums whitespace-nowrap">{formatMoney(i.total, i.currency_code)}</td>
                      <td className="py-1 text-right tabular-nums whitespace-nowrap">{formatMoney(i.amount_due, i.currency_code)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-neutral-600">Not yet</p>}
        </li>

        {timeline.map((s) => (
          <li key={s.key} className="rounded-lg border bg-white p-4 text-sm" data-testid={`stage-${s.key}`}>
            <h2 className="mb-1 font-semibold">{s.label}</h2>
            {s.entry ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <Link href={s.entry.href} className="underline">#{s.entry.number}{s.entry.summary ? ` · ${s.entry.summary}` : ''}</Link>
                <span>{s.entry.status}</span>
                <span className="text-neutral-600">Created {formatDateTime(s.entry.createdAt, tz)}</span>
                <span className="text-neutral-600">Updated {formatDateTime(s.entry.updatedAt, tz)}</span>
              </div>
            ) : <p className="text-neutral-600">Not yet</p>}
          </li>
        ))}
      </ol>
      <p className="text-xs text-neutral-600">Last linked {formatDateTime(file.updated_at, tz)}. Xero data is a read-only mirror.</p>
    </section>
  );
}
