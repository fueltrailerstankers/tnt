import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Display names (full name, else email, else "Team member") for the given users who are members of the org: the
 * "who" on stock activity and resolved exceptions. Service role, because profiles are readable only by their owner
 * and admins; call only after requirePerm, with ids taken from the org's own rows.
 */
export async function memberNames(orgId: string, userIds: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((x): x is string => typeof x === 'string' && x.length > 0))];
  if (!ids.length) return new Map();
  const db = createAdminClient();
  const { data: ms } = await db.from('memberships').select('user_id').eq('org_id', orgId).in('user_id', ids);
  const members = (ms ?? []).map((m) => m.user_id as string);
  if (!members.length) return new Map();
  const { data: ps } = await db.from('profiles').select('id, full_name, email').in('id', members);
  return new Map((ps ?? []).map((p) => [p.id as string, (p.full_name as string | null) || (p.email as string | null) || 'Team member']));
}
