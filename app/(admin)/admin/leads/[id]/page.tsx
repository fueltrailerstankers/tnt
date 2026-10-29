import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoney } from '@/lib/admin/format';
import { formatDateTime } from '@/lib/admin/grid';
import { loadOrg } from '@/lib/forms/org';
import { leadMembers } from '@/lib/leads/members';
import { LEAD_STATUSES } from '@/lib/leads/schema';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { addNote, assignLead, changeStatus } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lead · Trailers & Tankers' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EVENT_LABEL: Record<string, string> = {
  created: 'Lead received', duplicate: 'Linked as a duplicate', routed: 'Routed', emailed: 'Notification',
  matched: 'Xero match updated', status: 'Status changed', assigned: 'Assignment changed', note: 'Note',
};

function eventText(kind: string, meta: Record<string, unknown>, who: Map<string, string>): string {
  switch (kind) {
    case 'created': return `from ${String(meta.source ?? '')}`;
    case 'routed': return `to ${String(meta.event_key ?? '')}`;
    case 'emailed': return `${String(meta.status ?? '')} (${String(meta.recipients ?? 0)} recipient${meta.recipients === 1 ? '' : 's'})`;
    case 'status': return `${String(meta.from ?? '')} → ${String(meta.to ?? '')}`;
    case 'assigned': return meta.to ? `to ${who.get(String(meta.to)) ?? 'member'}` : 'unassigned';
    case 'matched': return [meta.quote_id ? 'quote' : null, meta.invoice_id ? 'invoice' : null].filter(Boolean).join(' and ') || 'no match';
    default: return '';
  }
}

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requirePerm('leads.read');
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const db = await createClient();
  const { data: lead } = await db.from('leads').select('*').eq('org_id', member.orgId).eq('id', id).maybeSingle();
  if (!lead) notFound();
  const [{ data: events }, { data: dupes }, { data: original }, { data: src }, members, org] = await Promise.all([
    db.from('lead_events').select('id, kind, actor, meta, body, created_at').eq('org_id', member.orgId).eq('lead_id', id).order('created_at', { ascending: true }),
    db.from('leads').select('id, name, created_at').eq('org_id', member.orgId).eq('duplicate_of', id).order('created_at', { ascending: true }).limit(50),
    lead.duplicate_of
      ? db.from('leads').select('id, name, created_at').eq('org_id', member.orgId).eq('id', lead.duplicate_of).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('lead_sources').select('name').eq('org_id', member.orgId).eq('key', lead.source).maybeSingle(),
    leadMembers(member.orgId),
    loadOrg(db, member.orgId),
  ]);
  const who = new Map(members.map((m) => [m.userId, m.label]));
  const manage = can(member, 'leads.manage');
  const tz = org.timezone;
  const utm = lead.utm && typeof lead.utm === 'object' ? Object.entries(lead.utm as Record<string, string>) : [];

  return (
    <section className="max-w-4xl space-y-4">
      <p className="text-xs text-neutral-600"><Link href="/admin/leads" className="underline">Leads</Link> / {lead.name || 'Lead'}</p>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{lead.name || '(no name)'}</h1>
        <span className="rounded bg-neutral-200 px-2 py-0.5 text-sm" data-testid="lead-status">{lead.status}</span>
        {lead.duplicate_of ? <span className="rounded bg-amber-100 px-2 py-0.5 text-sm text-amber-900">duplicate</span> : null}
      </div>
      {sp.saved ? <p role="status" className="rounded border border-green-300 bg-green-50 p-2 text-sm">Saved.</p> : null}
      {sp.error ? <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm">That change could not be saved.</p> : null}

      <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-white p-4 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-neutral-600">Email</dt><dd className="break-all">{lead.email}</dd></div>
        <div><dt className="text-xs text-neutral-600">Phone</dt><dd>{lead.phone}</dd></div>
        <div><dt className="text-xs text-neutral-600">Product / interest</dt><dd>{lead.product}</dd></div>
        <div><dt className="text-xs text-neutral-600">Branch</dt><dd>{lead.branch}</dd></div>
        <div><dt className="text-xs text-neutral-600">Source</dt><dd>{src?.name ?? lead.source}{lead.source_form ? ` / ${lead.source_form}` : ''}</dd></div>
        <div><dt className="text-xs text-neutral-600">Received</dt><dd>{formatDateTime(lead.created_at, tz)}</dd></div>
        <div><dt className="text-xs text-neutral-600">Assigned to</dt><dd>{lead.assigned_to ? who.get(lead.assigned_to) ?? 'Member' : 'Unassigned'}</dd></div>
        {lead.gclid ? <div><dt className="text-xs text-neutral-600">GCLID</dt><dd className="break-all">{lead.gclid}</dd></div> : null}
        {lead.fbclid ? <div><dt className="text-xs text-neutral-600">FBCLID</dt><dd className="break-all">{lead.fbclid}</dd></div> : null}
        {utm.length ? <div><dt className="text-xs text-neutral-600">UTM</dt><dd>{utm.map(([k, v]) => `${k}=${v}`).join(', ')}</dd></div> : null}
        {lead.message ? <div className="col-span-full"><dt className="text-xs text-neutral-600">Message</dt><dd className="whitespace-pre-wrap">{lead.message}</dd></div> : null}
      </dl>

      <div className="rounded-lg border bg-white p-4 text-sm" data-testid="lead-xero">
        <h2 className="mb-2 font-semibold">Xero</h2>
        {lead.matched_quote_id || lead.matched_invoice_id ? (
          <ul className="space-y-1">
            {lead.matched_quote_id ? (
              <li>Quote <Link href={`/admin/xero/quotes/${encodeURIComponent(lead.matched_quote_id)}`} className="underline">{lead.matched_quote_number ?? 'open'}</Link>
                {' '}· {lead.matched_quote_status} · {formatMoney(lead.matched_quote_total, lead.matched_quote_currency)}</li>
            ) : null}
            {lead.matched_invoice_id ? (
              <li>Latest invoice <Link href={`/admin/xero/invoices/${encodeURIComponent(lead.matched_invoice_id)}`} className="underline">{lead.matched_invoice_number ?? 'open'}</Link>
                {' '}· {lead.invoice_count} invoice{lead.invoice_count === 1 ? '' : 's'}, invoiced {formatMoney(lead.invoiced_total, lead.invoiced_currency)}</li>
            ) : null}
          </ul>
        ) : (
          <p className="text-neutral-600">{lead.matched_contact_ids?.length ? 'Matched a Xero contact; no quote sent or invoice yet.' : 'No matching Xero contact yet.'}</p>
        )}
        {lead.matched_at ? <p className="mt-1 text-xs text-neutral-600">Matched {formatDateTime(lead.matched_at, tz)}</p> : null}
      </div>

      {original || dupes?.length ? (
        <div className="rounded-lg border bg-white p-4 text-sm">
          <h2 className="mb-2 font-semibold">Duplicates</h2>
          {original ? <p>Duplicate of <Link href={`/admin/leads/${original.id}`} className="underline">{original.name || 'earlier lead'}</Link> ({formatDateTime(original.created_at, tz)})</p> : null}
          {dupes?.length ? (
            <ul className="mt-1 list-disc pl-5">
              {dupes.map((d) => <li key={d.id}><Link href={`/admin/leads/${d.id}`} className="underline">{d.name || 'later lead'}</Link> ({formatDateTime(d.created_at, tz)})</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      {manage ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <form action={changeStatus} className="flex items-end gap-2 rounded-lg border bg-white p-4 text-sm">
            <input type="hidden" name="id" value={lead.id} />
            <label className="flex flex-1 flex-col gap-1"><span>Status</span>
              <select name="status" defaultValue={lead.status} className="rounded border px-2 py-1">{LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
            <button className="rounded bg-neutral-900 px-3 py-1 text-white">Set status</button>
          </form>
          <form action={assignLead} className="flex items-end gap-2 rounded-lg border bg-white p-4 text-sm">
            <input type="hidden" name="id" value={lead.id} />
            <label className="flex flex-1 flex-col gap-1"><span>Assign to</span>
              <select name="assigned_to" defaultValue={lead.assigned_to ?? ''} className="rounded border px-2 py-1">
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.userId} value={m.userId}>{m.label}</option>)}
              </select></label>
            <button className="rounded bg-neutral-900 px-3 py-1 text-white">Assign</button>
          </form>
        </div>
      ) : null}

      <div className="rounded-lg border bg-white p-4 text-sm">
        <h2 className="mb-2 font-semibold">Timeline</h2>
        <ol className="space-y-2" data-testid="lead-timeline">
          {(events ?? []).map((e) => (
            <li key={e.id} className="border-l-2 pl-3">
              <span className="text-xs text-neutral-600">{formatDateTime(e.created_at, tz)}{e.actor ? ` · ${who.get(e.actor) ?? 'member'}` : ''}</span>
              <div>
                <span className="font-medium">{EVENT_LABEL[e.kind] ?? e.kind}</span>{' '}
                <span>{eventText(e.kind, (e.meta ?? {}) as Record<string, unknown>, who)}</span>
              </div>
              {e.kind === 'note' && e.body ? <p className="whitespace-pre-wrap">{e.body}</p> : null}
            </li>
          ))}
        </ol>
        {manage ? (
          <form action={addNote} className="mt-3 space-y-2">
            <input type="hidden" name="id" value={lead.id} />
            <label className="flex flex-col gap-1"><span>Add a note</span>
              <textarea name="body" rows={3} maxLength={4000} required className="rounded border px-2 py-1" /></label>
            <button className="rounded border px-3 py-1">Add note</button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
