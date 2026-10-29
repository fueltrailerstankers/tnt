import Link from 'next/link';
import { formatMoney, searchTerm } from '@/lib/admin/format';
import { MIRROR_PAGE, oneOf, pageOf } from '@/lib/admin/mirror';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invoices · Trailers & Tankers' };

const STATUSES = ['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID', 'VOIDED', 'DELETED'] as const;
const TYPES = ['ACCREC', 'ACCPAY', 'ALL'] as const;
const TYPE_LABEL: Record<(typeof TYPES)[number], string> = { ACCREC: 'Sales (ACCREC)', ACCPAY: 'Bills (ACCPAY)', ALL: 'All' };

export default async function Invoices({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requirePerm('xero.read');
  const sp = await searchParams;
  const q = searchTerm(sp.q);
  const status = oneOf(sp.status, STATUSES);
  const type = oneOf(sp.type, TYPES) ?? 'ACCREC';
  const page = pageOf(sp.page);
  const db = await createClient();
  let query = db.from('xero_invoices').select('invoice_id, invoice_number, invoice_type, reference, status, contact_name, invoice_date, due_date, currency_code, total, amount_due', { count: 'exact' })
    .eq('org_id', member.orgId).order('invoice_date', { ascending: false, nullsFirst: false }).order('invoice_number', { ascending: false })
    .range((page - 1) * MIRROR_PAGE, page * MIRROR_PAGE - 1);
  if (q) query = query.or(`invoice_number.ilike.*${q}*,contact_name.ilike.*${q}*,reference.ilike.*${q}*`);
  if (status) query = query.eq('status', status);
  if (type !== 'ALL') query = query.eq('invoice_type', type);
  const { data, count } = await query;
  const pages = Math.max(1, Math.ceil((count ?? 0) / MIRROR_PAGE));
  const link = (over: Record<string, string | null>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, status, type, page: String(page), ...over })) {
      if (v && !(k === 'page' && v === '1') && !(k === 'type' && v === 'ACCREC')) u.set(k, v);
    }
    return `/admin/xero/invoices${u.size ? `?${u}` : ''}`;
  };
  const noun = type === 'ACCPAY' ? 'bills' : 'invoices';

  return (
    <section className="space-y-4">
      <p className="text-xs text-neutral-600"><Link href="/admin/integrations/xero" className="underline">Xero</Link> / Invoices</p>
      <h1 className="text-2xl font-semibold">Invoices</h1>
      <p className="text-sm text-neutral-600">{count ?? 0} {noun} mirrored from Xero (read only).</p>
      <form method="get" className="flex flex-wrap items-end gap-2 rounded-lg border bg-white p-3 text-sm">
        <label className="flex flex-col"><span className="text-xs text-neutral-600">Search</span>
          <input name="q" defaultValue={q ?? ''} placeholder="Invoice no, customer or reference" className="rounded border px-2 py-1" /></label>
        <label className="flex flex-col"><span className="text-xs text-neutral-600">Type</span>
          <select name="type" defaultValue={type} className="rounded border px-2 py-1">{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></label>
        <label className="flex flex-col"><span className="text-xs text-neutral-600">Status</span>
          <select name="status" defaultValue={status ?? ''} className="rounded border px-2 py-1"><option value="">All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <button className="rounded bg-neutral-900 px-3 py-1 text-white">Apply</button>
      </form>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-100 text-left">
            <tr>
              <th className="p-2">Invoice</th><th className="p-2">Date</th><th className="p-2">Due</th><th className="p-2">{type === 'ACCPAY' ? 'Supplier' : 'Customer'}</th>
              <th className="p-2">Reference</th><th className="p-2">Status</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Due</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.invoice_id} className="border-t">
                <td className="p-2 whitespace-nowrap"><Link href={`/admin/xero/invoices/${r.invoice_id}`} className="underline">{r.invoice_number || '(no number)'}</Link></td>
                <td className="p-2 whitespace-nowrap">{r.invoice_date}</td>
                <td className="p-2 whitespace-nowrap">{r.due_date}</td>
                <td className="p-2">{r.contact_name}</td>
                <td className="p-2">{r.reference}</td>
                <td className="p-2">{r.status}</td>
                <td className="p-2 text-right tabular-nums whitespace-nowrap">{formatMoney(r.total, r.currency_code)}</td>
                <td className="p-2 text-right tabular-nums whitespace-nowrap">{formatMoney(r.amount_due, r.currency_code)}</td>
              </tr>
            ))}
            {!data?.length ? <tr><td colSpan={8} className="p-6 text-center text-neutral-600">No {noun}.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="flex gap-3 text-sm">
        {page > 1 ? <Link href={link({ page: String(page - 1) })} className="underline">Previous</Link> : null}
        <span>Page {page} of {pages}</span>
        {page < pages ? <Link href={link({ page: String(page + 1) })} className="underline">Next</Link> : null}
      </div>
    </section>
  );
}
