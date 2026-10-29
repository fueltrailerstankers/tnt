'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isLeadMember } from '@/lib/leads/members';
import { Assign, ManualLead, Note, StatusChange } from '@/lib/leads/schema';
import { createLead, rematchOpenLeads } from '@/lib/leads/service';
import { enqueue } from '@/lib/jobs/outbox';
import { assertPerm } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';

// Inbox server actions. Each one: requirePerm first, Zod validation, then the service-role client with
// every query filtered by member.orgId. Audit and event meta carry ids and field names only.

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : undefined;
};

async function audit(orgId: string, actor: string, action: string, entityId: string, meta: Record<string, unknown>) {
  await createAdminClient().from('audit_log').insert({ org_id: orgId, actor_user: actor, action, entity: 'lead', entity_id: entityId, meta });
}

export async function createManualLead(fd: FormData): Promise<void> {
  const member = await requirePerm('leads.manage');
  const parsed = ManualLead.safeParse({
    name: str(fd, 'name'), email: str(fd, 'email'), phone: str(fd, 'phone'),
    product: str(fd, 'product'), message: str(fd, 'message'), branch: str(fd, 'branch'),
  });
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'form')))];
    redirect(`/admin/leads/new?error=${encodeURIComponent(fields.join(','))}`);
  }
  const db = createAdminClient();
  const r = await createLead(db, member.orgId, { source: 'manual', ...parsed.data }, { actor: member.userId, notify: false });
  await audit(member.orgId, member.userId, 'lead.create', r.id, { source: 'manual', duplicate_of: r.duplicateOf });
  revalidatePath('/admin/leads');
  redirect(`/admin/leads/${r.id}`);
}

async function leadInOrg(orgId: string, id: string) {
  const { data } = await createAdminClient().from('leads').select('id, status, assigned_to').eq('org_id', orgId).eq('id', id).maybeSingle();
  return data as { id: string; status: string; assigned_to: string | null } | null;
}

export async function changeStatus(fd: FormData): Promise<void> {
  const member = await requirePerm('leads.manage');
  const parsed = StatusChange.safeParse({ id: str(fd, 'id'), status: str(fd, 'status') });
  if (!parsed.success) redirect('/admin/leads?error=status');
  const { id, status } = parsed.data;
  const lead = await leadInOrg(member.orgId, id);
  if (!lead) redirect('/admin/leads?error=notfound');
  if (lead.status !== status) {
    const db = createAdminClient();
    const { error } = await db.from('leads').update({ status }).eq('org_id', member.orgId).eq('id', id);
    if (error) redirect(`/admin/leads/${id}?error=status`);
    await db.from('lead_events').insert({ lead_id: id, kind: 'status', actor: member.userId, meta: { from: lead.status, to: status } });
    await audit(member.orgId, member.userId, 'lead.status', id, { from: lead.status, to: status });
  }
  revalidatePath(`/admin/leads/${id}`);
  redirect(`/admin/leads/${id}?saved=status`);
}

export async function assignLead(fd: FormData): Promise<void> {
  const member = await requirePerm('leads.manage');
  const parsed = Assign.safeParse({ id: str(fd, 'id'), assigned_to: str(fd, 'assigned_to') ?? '' });
  if (!parsed.success) redirect('/admin/leads?error=assign');
  const { id, assigned_to } = parsed.data;
  const lead = await leadInOrg(member.orgId, id);
  if (!lead) redirect('/admin/leads?error=notfound');
  if (assigned_to && !(await isLeadMember(member.orgId, assigned_to))) redirect(`/admin/leads/${id}?error=assign`);
  if (lead.assigned_to !== assigned_to) {
    const db = createAdminClient();
    const { error } = await db.from('leads').update({ assigned_to }).eq('org_id', member.orgId).eq('id', id);
    if (error) redirect(`/admin/leads/${id}?error=assign`);
    await db.from('lead_events').insert({ lead_id: id, kind: 'assigned', actor: member.userId, meta: { from: lead.assigned_to, to: assigned_to } });
    await audit(member.orgId, member.userId, 'lead.assign', id, { from: lead.assigned_to, to: assigned_to });
  }
  revalidatePath(`/admin/leads/${id}`);
  redirect(`/admin/leads/${id}?saved=assign`);
}

export async function addNote(fd: FormData): Promise<void> {
  const member = await requirePerm('leads.manage');
  const parsed = Note.safeParse({ id: str(fd, 'id'), body: str(fd, 'body') });
  if (!parsed.success) redirect(`/admin/leads/${encodeURIComponent(str(fd, 'id') ?? '')}?error=note`);
  const { id, body } = parsed.data;
  if (!(await leadInOrg(member.orgId, id))) redirect('/admin/leads?error=notfound');
  const { error } = await createAdminClient().from('lead_events').insert({ lead_id: id, kind: 'note', actor: member.userId, meta: {}, body });
  if (error) redirect(`/admin/leads/${id}?error=note`);
  revalidatePath(`/admin/leads/${id}`);
  redirect(`/admin/leads/${id}?saved=note`);
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
