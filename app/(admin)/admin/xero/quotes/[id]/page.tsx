import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoney } from '@/lib/admin/format';
import { UUID_PARAM } from '@/lib/deal-files/timeline';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requirePerm('quotes.read');
  const { id } = await params;
  if (!UUID_PARAM.test(id)) notFound();
  const db = await createClient();
  const { data: q } = await db.from('xero_quotes').select('quote_id, quote_number, quote_no, reference, status, contact_name, quote_date, expiry_date, currency_code, sub_total, total_tax, total, updated_utc').eq('org_id', member.orgId).eq('quote_id', id).maybeSingle();
  if (!q) notFound();
  const [{ data: lines }, { data: file }] = await Promise.all([
    db.from('xero_quote_lines').select('line_no, item_code, description, quantity, unit_amount, line_amount').eq('org_id', member.orgId).eq('quote_id', id).order('line_no'),
    db.from('deal_files').select('quote_no').eq('org_id', member.orgId).eq('quote_no', q.quote_no ?? '').maybeSingle(),
  ]);
  return (
    <section className="max-w-4xl space-y-4">
      <p className="text-xs text-fg-muted"><Link href="/admin/xero/quotes" className="underline">Quotes</Link> / {q.quote_number}</p>
      <h1 className="text-h1">{q.quote_number}</h1>
      <dl className="grid grid-cols-2 gap-3 rounded-md border bg-surface shadow-card p-4 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-fg-muted">Customer</dt><dd>{q.contact_name}</dd></div>
        <div><dt className="text-xs text-fg-muted">Status</dt><dd>{q.status}</dd></div>
        <div><dt className="text-xs text-fg-muted">Date</dt><dd>{q.quote_date}</dd></div>
        <div><dt className="text-xs text-fg-muted">Expires</dt><dd>{q.expiry_date}</dd></div>
        <div><dt className="text-xs text-fg-muted">Reference</dt><dd>{q.reference}</dd></div>
        <div><dt className="text-xs text-fg-muted">Subtotal</dt><dd>{formatMoney(q.sub_total, q.currency_code)}</dd></div>
        <div><dt className="text-xs text-fg-muted">Tax</dt><dd>{formatMoney(q.total_tax, q.currency_code)}</dd></div>
        <div><dt className="text-xs text-fg-muted">Total</dt><dd className="font-semibold">{formatMoney(q.total, q.currency_code)}</dd></div>
      </dl>
      {file ? <p className="text-sm"><Link href={`/admin/deal-files/${encodeURIComponent(file.quote_no)}`} className="underline">Open the deal file</Link></p> : null}
      <table className="w-full rounded-md border bg-surface shadow-card text-sm">
        <thead className="bg-surface-2 text-left text-label tracking-normal text-fg-muted"><tr><th className="p-2">#</th><th className="p-2">Item</th><th className="p-2">Description</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Unit</th><th className="p-2 text-right">Amount</th></tr></thead>
        <tbody>
          {(lines ?? []).map((l) => (
            <tr key={l.line_no} className="border-t">
              <td className="p-2">{l.line_no}</td><td className="p-2">{l.item_code}</td><td className="p-2">{l.description}</td>
              <td className="p-2 text-right tabular-nums">{l.quantity}</td><td className="p-2 text-right tabular-nums">{formatMoney(l.unit_amount, q.currency_code)}</td>
              <td className="p-2 text-right tabular-nums">{formatMoney(l.line_amount, q.currency_code)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
