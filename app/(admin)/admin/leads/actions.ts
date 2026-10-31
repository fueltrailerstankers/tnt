'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { isLeadMember } from '@/lib/leads/members';
import { Assign, ManualLead, Note, StatusChange } from '@/lib/leads/schema';
import { createLead, rematchOpenLeads } from '@/lib/leads/service';
import { enqueue } from '@/lib/jobs/outbox';
import { UI_SOURCES, type ActionResult, type AddLeadResult } from '@/lib/leads-view/actions';
import { assertPerm } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';

// Leads server actions (inbox, pipeline drawer, phone detail, Add lead). Each one: requirePerm('leads.manage')
// first, Zod validation, then the service-role client with every query filtered by member.orgId. Audit rows and
// lead_events.meta carry ids, statuses and field names only; results carry no personal data.

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : undefined;
};

async function audit(orgId: string, actor: string, action: string, entityId: string, meta: Record<string, unknown>) {
  await createAdminClient().from('audit_log').insert({ org_id: orgId, actor_user: actor, action, entity: 'lead', entity_id: entityId, meta });
}

const revalidateLeads = () => revalidatePath('/admin/leads', 'layout');

const leadFields = (fd: FormData) => ({
  name: str(fd, 'name'), email: str(fd, 'email'), phone: str(fd, 'phone'),
  product: str(fd, 'product'), message: str(fd, 'message'), branch: str(fd, 'branch'),
});

const SourceField = z.enum(UI_SOURCES);

/** Add lead modal: creates a manual (or test) lead; returns its id, or the names of the fields to fix. */
export async function addLead(fd: FormData): Promise<AddLeadResult> {
  const member = await requirePerm('leads.manage');
  const parsed = ManualLead.safeParse(leadFields(fd));
  const source = SourceField.safeParse(str(fd, 'source') ?? 'manual');
  if (!parsed.success || !source.success) {
    const fields = [
      ...(parsed.success ? [] : parsed.error.issues.map((i) => String(i.path[0] ?? 'form'))),
      ...(source.success ? [] : ['source']),
    ];
    return { ok: false, error: 'invalid', fields: [...new Set(fields)] };
  }
  try {
    const r = await createLead(createAdminClient(), member.orgId, { source: source.data, ...parsed.data }, { actor: member.userId, notify: false });
    await audit(member.orgId, member.userId, 'lead.create', r.id, { source: source.data, duplicate_of: r.duplicateOf });
    revalidateLeads();
    return { ok: true, id: r.id, duplicate: Boolean(r.duplicateOf) };
  } catch {
    return { ok: false, error: 'save', fields: [] };
  }
}

/** Full-page form at /admin/leads/new (works without JavaScript). */
export async function createManualLead(fd: FormData): Promise<void> {
  const r = await addLead(fd);
  if (!r.ok) redirect(`/admin/leads/new?error=${encodeURIComponent(r.fields.length ? r.fields.join(',') : 'form')}`);
  redirect(`/admin/leads/${r.id}`);
}

async function leadInOrg(orgId: string, id: string) {
  const { data } = await createAdminClient().from('leads').select('id, status, assigned_to').eq('org_id', orgId).eq('id', id).maybeSingle();
  return data as { id: string; status: string; assigned_to: string | null } | null;
}

/** Status / stage change (inbox Status select, pipeline drawer and phone stage pills). */
export async function setLeadStatus(input: { id: string; status: string }): Promise<ActionResult> {
  const member = await requirePerm('leads.manage');
  const parsed = StatusChange.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { id, status } = parsed.data;
  const lead = await leadInOrg(member.orgId, id);
  if (!lead) return { ok: false, error: 'notfound' };
  if (lead.status !== status) {
    const db = createAdminClient();
    const { error } = await db.from('leads').update({ status }).eq('org_id', member.orgId).eq('id', id);
    if (error) return { ok: false, error: 'save' };
    await db.from('lead_events').insert({ lead_id: id, kind: 'status', actor: member.userId, meta: { from: lead.status, to: status } });
    await audit(member.orgId, member.userId, 'lead.status', id, { from: lead.status, to: status });
  }
  revalidateLeads();
  return { ok: true };
}

export async function setLeadAssignee(input: { id: string; assigned_to: string }): Promise<ActionResult> {
  const member = await requirePerm('leads.manage');
  const parsed = Assign.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { id, assigned_to } = parsed.data;
  const lead = await leadInOrg(member.orgId, id);
  if (!lead) return { ok: false, error: 'notfound' };
  if (assigned_to && !(await isLeadMember(member.orgId, assigned_to))) return { ok: false, error: 'invalid' };
  if (lead.assigned_to !== assigned_to) {
    const db = createAdminClient();
    const { error } = await db.from('leads').update({ assigned_to }).eq('org_id', member.orgId).eq('id', id);
    if (error) return { ok: false, error: 'save' };
    await db.from('lead_events').insert({ lead_id: id, kind: 'assigned', actor: member.userId, meta: { from: lead.assigned_to, to: assigned_to } });
    await audit(member.orgId, member.userId, 'lead.assign', id, { from: lead.assigned_to, to: assigned_to });
  }
  revalidateLeads();
  return { ok: true };
}

export async function addLeadNote(input: { id: string; body: string }): Promise<ActionResult> {
  const member = await requirePerm('leads.manage');
  const parsed = Note.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { id, body } = parsed.data;
  if (!(await leadInOrg(member.orgId, id))) return { ok: false, error: 'notfound' };
  const { error } = await createAdminClient().from('lead_events').insert({ lead_id: id, kind: 'note', actor: member.userId, meta: {}, body });
  if (error) return { ok: false, error: 'save' };
  revalidateLeads();
  return { ok: true };
}

/** Admins: re-run Xero matching for every open lead now; whatever does not fit the time budget is queued. */
export async function rematchLeads(): Promise<void> {
  const member = assertPerm(await requirePerm('leads.manage'), 'integrations.manage');
  const db = createAdminClient();
  const r = await rematchOpenLeads(db, member.orgId, { actor: member.userId, budgetMs: 20_000 });
  if (!r.complete) await enqueue(db, member.orgId, 'leads.rematch', { from: r.next });
  await db.from('audit_log').insert({
    org_id: member.orgId, actor_user: member.userId, action: 'leads.rematch', entity: 'lead', entity_id: null,
    meta: { checked: r.checked, changed: r.changed, complete: r.complete },
  });
  revalidatePath('/admin/leads');
  redirect(`/admin/leads?rematched=${r.changed}&checked=${r.checked}${r.complete ? '' : '&queued=1'}`);
}
