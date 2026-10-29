import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoney } from '@/lib/admin/format';
import { UUID_PARAM } from '@/lib/deal-files/timeline';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function fileSize(n: number | string | null): string {
  const b = Number(n);
  if (n === null || !Number.isFinite(b) || b < 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requirePerm('xero.read');
  const { id } = await params;
  if (!UUID_PARAM.test(id)) notFound();
  const db = await createClient();
  const { data: inv } = await db.from('xero_invoices')
    .select('invoice_id, invoice_number, invoice_type, reference, status, contact_name, invoice_date, due_date, currency_code, sub_total, total_tax, total, amount_due, amount_paid, amount_credited, fully_paid_on, has_attachments, attachments_synced_at')
    .eq('org_id', member.orgId).eq('invoice_id', id).maybeSingle();
  if (!inv) notFound();
  const cur = inv.currency_code;
  const [{ data: lines }, { data: payments }, { data: files }, { data: deal }] = await Promise.all([
    db.from('xero_invoice_lines').select('line_no, item_code, description, quantity, unit_amount, line_amount').eq('org_id', member.orgId).eq('invoice_id', id).order('line_no'),
    db.from('xero_payments').select('payment_id, payment_date, amount, currency_code, status, payment_type, reference').eq('org_id', member.orgId).eq('invoice_id', id).order('payment_date', { ascending: true }),
    db.from('xero_attachments').select('attachment_id, file_name, mime_type, content_length').eq('org_id', member.orgId).eq('parent_type', 'Invoice').eq('parent_id', id).order('file_name'),
    db.from('deal_files').select('quote_no').eq('org_id', member.orgId).contains('invoice_ids', [id]).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const title = inv.invoice_number || '(no number)';

  return (
    <section className="max-w-4xl space-y-4">
      <p className="text-xs text-neutral-600"><Link href="/admin/xero/invoices" className="underline">Invoices</Link> / {title}</p>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-white p-4 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-neutral-600">{inv.invoice_type === 'ACCPAY' ? 'Supplier' : 'Customer'}</dt><dd>{inv.contact_name}</dd></div>
        <div><dt className="text-xs text-neutral-600">Status</dt><dd>{inv.status}</dd></div>
        <div><dt className="text-xs text-neutral-600">Type</dt><dd>{inv.invoice_type === 'ACCPAY' ? 'Bill (ACCPAY)' : inv.invoice_type === 'ACCREC' ? 'Sales (ACCREC)' : inv.invoice_type}</dd></div>
        <div><dt className="text-xs text-neutral-600">Reference</dt><dd className="break-words">{inv.reference}</dd></div>
        <div><dt className="text-xs text-neutral-600">Date</dt><dd>{inv.invoice_date}</dd></div>
        <div><dt className="text-xs text-neutral-600">Due</dt><dd>{inv.due_date}</dd></div>
        <div><dt className="text-xs text-neutral-600">Fully paid on</dt><dd>{inv.fully_paid_on ?? '-'}</dd></div>
        <div><dt className="text-xs text-neutral-600">Currency</dt><dd>{cur}</dd></div>
      </dl>
      <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-white p-4 text-sm sm:grid-cols-3" data-testid="invoice-amounts">
        <div><dt className="text-xs text-neutral-600">Subtotal</dt><dd className="tabular-nums">{formatMoney(inv.sub_total, cur)}</dd></div>
        <div><dt className="text-xs text-neutral-600">Tax</dt><dd className="tabular-nums">{formatMoney(inv.total_tax, cur)}</dd></div>
        <div><dt className="text-xs text-neutral-600">Total</dt><dd className="font-semibold tabular-nums">{formatMoney(inv.total, cur)}</dd></div>
        <div><dt className="text-xs text-neutral-600">Paid</dt><dd className="tabular-nums">{formatMoney(inv.amount_paid, cur)}</dd></div>
        <div><dt className="text-xs text-neutral-600">Credited</dt><dd className="tabular-nums">{formatMoney(inv.amount_credited, cur)}</dd></div>
        <div><dt className="text-xs text-neutral-600">Amount due</dt><dd className="font-semibold tabular-nums">{formatMoney(inv.amount_due, cur)}</dd></div>
      </dl>
      {deal ? <p className="text-sm"><Link href={`/admin/deal-files/${encodeURIComponent(deal.quote_no)}`} className="underline">Open the deal file ({deal.quote_no})</Link></p> : null}

      <h2 className="font-semibold">Lines</h2>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-100 text-left"><tr><th className="p-2">#</th><th className="p-2">Item</th><th className="p-2">Description</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Unit</th><th className="p-2 text-right">Amount</th></tr></thead>
          <tbody>
            {(lines ?? []).map((l) => (
              <tr key={l.line_no} className="border-t">
                <td className="p-2">{l.line_no}</td><td className="p-2">{l.item_code}</td><td className="p-2">{l.description}</td>
                <td className="p-2 text-right tabular-nums">{l.quantity}</td><td className="p-2 text-right tabular-nums whitespace-nowrap">{formatMoney(l.unit_amount, cur)}</td>
                <td className="p-2 text-right tabular-nums whitespace-nowrap">{formatMoney(l.line_amount, cur)}</td>
              </tr>
            ))}
            {!lines?.length ? <tr><td colSpan={6} className="p-4 text-center text-neutral-600">No lines.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <h2 className="font-semibold">Payments</h2>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm" data-testid="invoice-payments">
          <thead className="bg-neutral-100 text-left"><tr><th className="p-2">Date</th><th className="p-2">Type</th><th className="p-2">Reference</th><th className="p-2">Status</th><th className="p-2 text-right">Amount</th></tr></thead>
          <tbody>
            {(payments ?? []).map((p) => (
              <tr key={p.payment_id} className="border-t">
                <td className="p-2 whitespace-nowrap">{p.payment_date}</td><td className="p-2">{p.payment_type}</td><td className="p-2">{p.reference}</td>
                <td className="p-2">{p.status}</td><td className="p-2 text-right tabular-nums whitespace-nowrap">{formatMoney(p.amount, p.currency_code ?? cur)}</td>
              </tr>
            ))}
            {!payments?.length ? <tr><td colSpan={5} className="p-4 text-center text-neutral-600">No payments.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <h2 className="font-semibold">Attachments</h2>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm" data-testid="invoice-attachments">
          <thead className="bg-neutral-100 text-left"><tr><th className="p-2">File</th><th className="p-2">Type</th><th className="p-2 text-right">Size</th></tr></thead>
          <tbody>
            {(files ?? []).map((f) => (
              <tr key={f.attachment_id} className="border-t">
                <td className="p-2 break-all">{f.file_name}</td><td className="p-2">{f.mime_type}</td><td className="p-2 text-right tabular-nums whitespace-nowrap">{fileSize(f.content_length)}</td>
              </tr>
            ))}
            {!files?.length ? (
              <tr><td colSpan={3} className="p-4 text-center text-neutral-600">
                {inv.has_attachments && !inv.attachments_synced_at ? 'Xero has attachments; their details are not synced yet.' : 'No attachments.'}
              </td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-600">Attachment details only. Files stay in Xero.</p>
    </section>
  );
}
