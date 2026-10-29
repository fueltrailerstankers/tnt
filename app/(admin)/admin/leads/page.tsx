import Link from 'next/link';
import { searchTerm } from '@/lib/admin/format';
import { formatDateTime } from '@/lib/admin/grid';
import { MIRROR_PAGE, oneOf, pageOf } from '@/lib/admin/mirror';
import { loadOrg } from '@/lib/forms/org';
import { leadMembers } from '@/lib/leads/members';
import { LEAD_STATUSES } from '@/lib/leads/schema';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { rematchLeads } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leads · Trailers & Tankers' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function Leads({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requirePerm('leads.read');
  const sp = await searchParams;
  const db = await createClient();
  const [{ data: sources }, members, org] = await Promise.all([
    db.from('lead_sources').select('key, name').eq('org_id', member.orgId).order('name'),
    leadMembers(member.orgId),
    loadOrg(db, member.orgId),
  ]);
  const q = searchTerm(sp.q);
  const status = oneOf(sp.status, LEAD_STATUSES);
  const source = oneOf(sp.source, (sources ?? []).map((s) => s.key as string));
  const branch = searchTerm(sp.branch);
  const assignedRaw = one(sp.assigned);
  const assigned = assignedRaw === 'me' || assignedRaw === 'none' || UUID.test(assignedRaw) ? assignedRaw : null;
  const dups = one(sp.dups) === '1';
  const page = pageOf(sp.page);

  let query = db.from('leads')
    .select('id, created_at, name, product, source, branch, status, assigned_to, duplicate_of, matched_quote_number, matched_invoice_number', { count: 'exact' })
    .eq('org_id', member.orgId).order('created_at', { ascending: false }).order('id', { ascending: false })
    .range((page - 1) * MIRROR_PAGE, page * MIRROR_PAGE - 1);
  if (q) query = query.ilike('search_text', `*${q.toLowerCase()}*`);
  if (status) query = query.eq('status', status);
  if (source) query = query.eq('source', source);
  if (branch) query = query.ilike('branch', branch);
  if (assigned === 'me') query = query.eq('assigned_to', member.userId);
  else if (assigned === 'none') query = query.is('assigned_to', null);
  else if (assigned) query = query.eq('assigned_to', assigned);
  if (dups) query = query.not('duplicate_of', 'is', null);
  const { data, count } = await query;

  const pages = Math.max(1, Math.ceil((count ?? 0) / MIRROR_PAGE));
  const who = new Map(members.map((m) => [m.userId, m.label]));
  const srcName = new Map((sources ?? []).map((s) => [s.key as string, s.name as string]));
  const link = (over: Record<string, string | null>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, status, source, branch, assigned, dups: dups ? '1' : null, page: String(page), ...over })) {
      if (v && !(k === 'page' && v === '1')) u.set(k, v);
    }
    return `/admin/leads${u.size ? `?${u}` : ''}`;
  };
  const rematched = one(sp.rematched);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-h1">Leads</h1>
        <div className="flex gap-2">
          {can(member, 'integrations.manage') ? (
            <form action={rematchLeads}><button className="rounded-pill border border-border-strong bg-surface font-semibold text-fg no-underline px-3 py-1 text-sm">Re-match open leads with Xero</button></form>
          ) : null}
          {can(member, 'leads.manage') ? <Link href="/admin/leads/new" className="rounded-pill bg-accent px-3.5 py-1.5 text-sm font-semibold text-accent-fg no-underline">New lead</Link> : null}
        </div>
      </div>
      {rematched ? (
        <p role="status" className="rounded-sm bg-status-green-bg p-2 text-sm font-semibold text-status-green-fg">
          Checked {one(sp.checked)} open leads; {rematched} match{rematched === '1' ? '' : 'es'} changed.{one(sp.queued) ? ' The rest continues in the background.' : ''}
        </p>
      ) : null}
      <p className="text-sm text-fg-muted">{count ?? 0} lead{count === 1 ? '' : 's'}.</p>
      <form method="get" className="flex flex-wrap items-end gap-2 rounded-md border bg-surface shadow-card p-3 text-sm">
        <label className="flex flex-col"><span className="text-xs text-fg-muted">Search</span>
          <input name="q" defaultValue={q ?? ''} placeholder="Name, email, phone or product" className="rounded-sm border px-2 py-1" /></label>
        <label className="flex flex-col"><span className="text-xs text-fg-muted">Status</span>
          <select name="status" defaultValue={status ?? ''} className="rounded-sm border px-2 py-1"><option value="">All</option>{LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="flex flex-col"><span className="text-xs text-fg-muted">Source</span>
          <select name="source" defaultValue={source ?? ''} className="rounded-sm border px-2 py-1"><option value="">All</option>{(sources ?? []).map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select></label>
        <label className="flex flex-col"><span className="text-xs text-fg-muted">Branch</span>
          <input name="branch" defaultValue={branch ?? ''} className="w-32 rounded-sm border px-2 py-1" /></label>
        <label className="flex flex-col"><span className="text-xs text-fg-muted">Assigned</span>
          <select name="assigned" defaultValue={assigned ?? ''} className="rounded-sm border px-2 py-1">
            <option value="">Anyone</option><option value="me">Me</option><option value="none">Unassigned</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.label}</option>)}
          </select></label>
        <label className="flex items-center gap-1 pb-1"><input type="checkbox" name="dups" value="1" defaultChecked={dups} /> Duplicates only</label>
        <button className="rounded-pill bg-accent px-3.5 py-1.5 font-semibold text-accent-fg">Apply</button>
      </form>
      <div className="overflow-x-auto rounded-md border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-label tracking-normal text-fg-muted">
            <tr><th className="p-2">Received</th><th className="p-2">Name</th><th className="p-2">Product</th><th className="p-2">Source</th><th className="p-2">Branch</th><th className="p-2">Status</th><th className="p-2">Assigned</th><th className="p-2">Xero</th></tr>
          </thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id} className="border-t" data-testid="lead-row">
                <td className="p-2 whitespace-nowrap"><Link href={`/admin/leads/${r.id}`} className="underline">{formatDateTime(r.created_at, org.timezone)}</Link></td>
                <td className="p-2">
                  <Link href={`/admin/leads/${r.id}`} className="underline">{r.name || '(no name)'}</Link>
                  {r.duplicate_of ? <span className="ml-2 rounded bg-status-yellow-bg px-1 text-xs text-status-yellow-fg">duplicate</span> : null}
                </td>
                <td className="p-2">{r.product}</td>
                <td className="p-2">{srcName.get(r.source) ?? r.source}</td>
                <td className="p-2">{r.branch}</td>
                <td className="p-2">{r.status}</td>
                <td className="p-2">{r.assigned_to ? who.get(r.assigned_to) ?? 'Member' : ''}</td>
                <td className="p-2">{[r.matched_quote_number, r.matched_invoice_number].filter(Boolean).join(' · ')}</td>
              </tr>
            ))}
            {!data?.length ? <tr><td colSpan={8} className="p-6 text-center text-fg-muted">No leads.</td></tr> : null}
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
