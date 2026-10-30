import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Display names of org members by user id ("reviewed by", "counted by", "By" on Home). Service role, because RLS
 * hides other members' profiles from non-admins: call only after requirePerm. Only members of `orgId` are
 * resolved; anyone else stays unnamed. Never returns emails, and names are never logged.
 */
export async function memberNames(orgId: string, userIds: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const ids = [...new Set([...userIds].filter((x): x is string => typeof x === 'string' && x.length > 0))].slice(0, 200);
  const out = new Map<string, string>();
  if (!ids.length) return out;
  try {
    const db = createAdminClient();
    const { data: ms } = await db.from('memberships').select('user_id').eq('org_id', orgId).in('user_id', ids);
    const members = (ms ?? []).map((m) => m.user_id as string);
    if (!members.length) return out;
    const { data: ps } = await db.from('profiles').select('id, full_name').in('id', members);
    for (const p of ps ?? []) {
      const name = (p.full_name as string | null)?.trim();
      out.set(p.id as string, name || 'Staff member');
    }
  } catch {
    // Names are decoration: a failed read leaves them out rather than breaking the page.
  }
  return out;
}
