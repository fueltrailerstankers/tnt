import 'server-only';
import { notFound } from 'next/navigation';
import { loadForm } from '@/lib/forms/forms';
import { loadOrg } from '@/lib/forms/org';
import type { Permission } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Admin request context: checks the permission, loads the form through the user's RLS-scoped client
 * (so another org's slug is simply not found), and only then hands out the service-role client.
 */
export async function adminForm(slug: string, permission: Permission) {
  const member = await requirePerm(permission);
  const userDb = await createClient();
  const form = await loadForm(userDb, member.orgId, slug);
  if (!form) notFound();
  const db = createAdminClient();
  const org = await loadOrg(userDb, member.orgId);
  return { member, userDb, db, form, org };
}
