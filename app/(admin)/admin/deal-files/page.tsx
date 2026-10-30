import Link from 'next/link';
import { searchTerm } from '@/lib/admin/format';
import { MIRROR_PAGE, pageOf } from '@/lib/admin/mirror';
import { DEAL_STAGES, stagesPresent } from '@/lib/deal-files/timeline';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Deal files · Trailers & Tankers' };

export default async function DealFiles({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requirePerm('deals.read');
  const sp = await searchParams;
  const q = searchTerm(sp.q);
  const page = pageOf(sp.page);
  const db = await createClient();
  let query = db.from('deal_files')
    .select('id, quote_no, customer_name, vin, branch, rep, invoice_numbers, deal_entry_id, rfi_entry_id, job_card_entry_id, inspection_entry_id, release_entry_id, delivery_entry_id', { count: 'exact' })
    .eq('org_id', member.orgId).order('updated_at', { ascending: false }).order('quote_no', { ascending: false })
    .range((page - 1) * MIRROR_PAGE, page * MIRROR_PAGE - 1);
  if (q) query = query.or(`quote_no.ilike.*${q}*,vin.ilike.*${q}*,customer_name.ilike.*${q}*`);
  const { data, count } = await query;
  const pages = Math.max(1, Math.ceil((count ?? 0) / MIRROR_PAGE));
  const link = (over: Record<string, string | null>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, page: String(page), ...over })) if (v && !(k === 'page' && v === '1')) u.set(k, v);
    return `/admin/deal-files${u.size ? `?${u}` : ''}`;
  };

  return (
    <section className="space-y-4">
      <h1 className="text-h1">Deal files</h1>
      <p className="text-sm text-fg-muted">{count ?? 0} deal files: one per trailer, from deal to delivery. Newest activity first.</p>
      <form method="get" className="flex flex-wrap items-end gap-2 rounded-md border bg-surface shadow-card p-3 text-sm">
        <label className="flex flex-col"><span className="text-xs text-fg-muted">Search</span>
          <input name="q" defaultValue={q ?? ''} placeholder="Quote no, VIN or customer" className="rounded-sm border px-2 py-1" /></label>
        <button className="rounded-pill bg-accent px-3.5 py-1.5 font-semibold text-accent-fg">Apply</button>
      </form>
      <div className="overflow-x-auto rounded-md border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-label tracking-normal text-fg-muted">
            <tr>
              <th className="p-2">Quote</th><th className="p-2">Customer</th><th className="p-2">VIN</th><th className="p-2">Branch</th><th className="p-2">Rep</th><th className="p-2">Invoices</th>
              {DEAL_STAGES.map((s) => <th key={s.key} className="p-2 text-center text-xs font-medium whitespace-nowrap" title={s.label}>{s.short}</th>)}
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2 whitespace-nowrap"><Link href={`/admin/deal-files/${encodeURIComponent(r.quote_no)}`} className="underline">{r.quote_no}</Link></td>
                <td className="p-2">{r.customer_name}</td>
                <td className="p-2 font-mono text-xs whitespace-nowrap">{r.vin}</td>
                <td className="p-2">{r.branch}</td>
                <td className="p-2">{r.rep}</td>
                <td className="p-2 text-xs">{(r.invoice_numbers ?? []).join(', ')}</td>
                {stagesPresent(r).map((s) => (
                  <td key={s.key} className="p-2 text-center">
                    {s.present
                      ? <span className="text-status-green-fg" aria-label={`${s.short}: yes`} title={`${s.short}: yes`}>✓</span>
                      : <span className="text-fg-subtle" aria-label={`${s.short}: not yet`} title={`${s.short}: not yet`}>·</span>}
                  </td>
                ))}
              </tr>
            ))}
            {!data?.length ? <tr><td colSpan={6 + DEAL_STAGES.length} className="p-6 text-center text-fg-muted">No deal files.</td></tr> : null}
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
