'use server';

import { revalidatePath } from 'next/cache';
import { parseRecipient, type RecipientErrors } from '@/lib/settings/recipients';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export type RecipientState = { ok?: boolean; errors?: RecipientErrors };

const PAGE = '/admin/settings/notifications';

/**
 * Adds or edits one notification recipient (event key, address, branch, active). settings.manage only; the write
 * goes through the caller's client so RLS (Settings write, own org) applies as well. The audit row has the
 * recipient id and event key, never the address.
 */
export async function saveRecipient(_prev: RecipientState, fd: FormData): Promise<RecipientState> {
  const member = await requirePerm('settings.manage');
  const id = fd.get('id');
  const parsed = parseRecipient({
    id: typeof id === 'string' && id ? id : null,
    eventKey: fd.get('eventKey'),
    address: fd.get('address'),
    branch: fd.get('branch'),
    active: fd.get('active') === 'on',
  });
  if (!parsed.ok) return { errors: parsed.errors };
  const v = parsed.value;
  const db = await createClient();
  const row = { event_key: v.eventKey, address: v.address, branch: v.branch, active: v.active };
  const res = v.id
    ? await db.from('notification_recipients').update(row).eq('id', v.id).eq('org_id', member.orgId).select('id').maybeSingle()
    : await db.from('notification_recipients').insert({ org_id: member.orgId, ...row }).select('id').single();
  if (res.error) {
    if (res.error.code === '23505' || /duplicate/i.test(res.error.message)) return { errors: { address: 'This address already gets this event.' } };
    return { errors: { form: 'The recipient could not be saved.' } };
  }
  if (!res.data) return { errors: { form: 'This recipient no longer exists. Reload the page.' } };
  await createAdminClient().from('audit_log').insert({
    org_id: member.orgId, actor_user: member.userId, action: v.id ? 'settings.recipient.update' : 'settings.recipient.add',
    entity: 'notification_recipient', entity_id: res.data.id as string, meta: { event_key: v.eventKey, active: v.active, branch: v.branch !== null },
  });
  revalidatePath(PAGE);
  return { ok: true };
}
