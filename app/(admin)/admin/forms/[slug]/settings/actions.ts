'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { adminForm } from '@/lib/admin/context';
import { eventKey } from '@/lib/workflow/email-template';

const settingsUrl = (slug: string) => `/admin/forms/${slug}/settings`;

export async function setPublicLink(slug: string, fd: FormData): Promise<void> {
  const { member, userDb, db, form } = await adminForm(slug, 'forms.manage');
  const active = fd.get('active') === 'on';
  // User client: forms_admin RLS policy is the second check.
  await userDb.from('forms').update({ is_active: active }).eq('id', form.id);
  await db.from('audit_log').insert({ org_id: member.orgId, actor_user: member.userId, action: 'form.public_link', entity: 'form', entity_id: form.id, meta: { active } });
  revalidatePath(settingsUrl(slug));
  redirect(settingsUrl(slug));
}

const Recipient = z.object({ action: z.string().min(1).max(64), address: z.string().trim().toLowerCase().email().max(254) });

export async function addRecipient(slug: string, fd: FormData): Promise<void> {
  const { member, userDb, form } = await adminForm(slug, 'forms.manage');
  const parsed = Recipient.safeParse({ action: fd.get('action'), address: fd.get('address') });
  if (!parsed.success || !form.spec.workflow.actions.some((a) => a.name === parsed.data.action)) redirect(`${settingsUrl(slug)}?error=recipient`);
  await userDb.from('notification_recipients').upsert(
    { org_id: member.orgId, event_key: eventKey(slug, parsed.data.action), address: parsed.data.address, active: true },
    { onConflict: 'org_id,event_key,address' },
  );
  revalidatePath(settingsUrl(slug));
  redirect(settingsUrl(slug));
}

export async function removeRecipient(slug: string, id: string): Promise<void> {
  const { member, userDb } = await adminForm(slug, 'forms.manage');
  await userDb.from('notification_recipients').delete().eq('id', id).eq('org_id', member.orgId).like('event_key', `${slug}.%`);
  revalidatePath(settingsUrl(slug));
  redirect(settingsUrl(slug));
}
