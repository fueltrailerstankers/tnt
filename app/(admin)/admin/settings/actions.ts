'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const Org = z.object({
  name: z.string().trim().min(1).max(120),
  timezone: z.string().refine((z) => Intl.supportedValuesOf('timeZone').includes(z)),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
});

export async function saveOrg(fd: FormData): Promise<void> {
  const member = await requirePerm('settings.manage');
  const parsed = Org.safeParse({ name: fd.get('name'), timezone: fd.get('timezone'), currency: fd.get('currency') });
  if (!parsed.success) redirect('/admin/settings?error=1');
  const db = await createClient();
  await db.from('orgs').update({ name: parsed.data.name, timezone: parsed.data.timezone, currency_code: parsed.data.currency }).eq('id', member.orgId);
  await createAdminClient().from('audit_log').insert({
    org_id: member.orgId, actor_user: member.userId, action: 'settings.org', entity: 'org', entity_id: member.orgId,
    meta: { timezone: parsed.data.timezone, currency: parsed.data.currency },
  });
  revalidatePath('/admin', 'layout');
  redirect('/admin/settings?saved=1');
}
