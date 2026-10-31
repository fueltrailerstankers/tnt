'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { NameInput } from '@/lib/users/rules';
import { audit } from '@/lib/users/service';

/** My account: the member changes their own name (membership display name and profile). Audited without the name. */
export async function saveMyName(fd: FormData): Promise<void> {
  const member = await requirePerm('admin.access');
  const parsed = NameInput.safeParse({ name: fd.get('name') });
  if (!parsed.success) redirect('/admin/account?error=name');
  const db = createAdminClient();
  await db.from('memberships').update({ display_name: parsed.data.name }).eq('org_id', member.orgId).eq('user_id', member.userId);
  await db.from('profiles').update({ full_name: parsed.data.name }).eq('id', member.userId);
  await audit(member.orgId, member.userId, 'user.name', member.userId);
  revalidatePath('/admin', 'layout');
  redirect('/admin/account?saved=1');
}
