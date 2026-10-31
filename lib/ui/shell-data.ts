import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadForms } from '@/lib/forms/forms';
import { can, type Member } from '@/lib/security/can';
import { createAdminClient } from '@/lib/supabase/admin';
import { taskStatuses } from '@/lib/workflow/rules';

export interface ShellData {
  tasks: number;
  userName: string | null;
  xero: { connected: boolean; lastSync: string | null } | null;
}

/** Entries waiting on staff, the same definition the Tasks page uses. Errors count as zero: the shell must never break a page. */
async function taskCount(db: SupabaseClient, orgId: string): Promise<number> {
  try {
    const forms = await loadForms(db, orgId);
    const counts = await Promise.all(
      forms.map(async (form) => {
        const statuses = taskStatuses(form.spec);
        if (!statuses.length) return 0;
        const { count } = await db.from('entries').select('id', { count: 'exact', head: true }).eq('form_id', form.id).in('status', statuses);
        return count ?? 0;
      }),
    );
    return counts.reduce((a, b) => a + b, 0);
  } catch {
    return 0;
  }
}

/** Connection state and last sync only. Token columns are never selected here. Service role, after the showsXeroStatus check. */
async function xeroStatus(orgId: string): Promise<ShellData['xero']> {
  try {
    const admin = createAdminClient();
    const [{ data: conn }, { data: sync }] = await Promise.all([
      admin.from('xero_connections').select('status').eq('org_id', orgId).order('connected_at', { ascending: false }).limit(1).maybeSingle(),
      admin.from('xero_sync_state').select('last_run_at').eq('org_id', orgId).order('last_run_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    ]);
    return { connected: conn?.status === 'connected', lastSync: (sync?.last_run_at as string | null) ?? null };
  } catch {
    return null;
  }
}

/** The member's name in this org (Users & access), else their profile name. */
async function displayName(db: SupabaseClient, member: Member): Promise<string | null> {
  try {
    const [{ data: m }, { data }] = await Promise.all([
      db.from('memberships').select('display_name').eq('org_id', member.orgId).eq('user_id', member.userId).maybeSingle(),
      db.from('profiles').select('full_name').eq('id', member.userId).maybeSingle(),
    ]);
    return (m?.display_name as string | null) || ((data?.full_name as string | null) ?? null);
  } catch {
    return null;
  }
}

export async function loadShellData(db: SupabaseClient, member: Member): Promise<ShellData> {
  const [tasks, userName, xero] = await Promise.all([
    can(member, 'tasks.read') ? taskCount(db, member.orgId) : Promise.resolve(0),
    displayName(db, member),
    showsXeroStatus(member) ? xeroStatus(member.orgId) : Promise.resolve(null),
  ]);
  return { tasks, userName, xero };
}

/** The sidebar's Xero connection line: for members who read the mirror (quotes, invoices) or Integrations. */
export function showsXeroStatus(member: Member): boolean {
  return can(member, 'quotes.read') || can(member, 'invoices.read') || can(member, 'integrations.read');
}

// Kept for existing imports; the pure helper lives in lib/ui/initials.ts so client components can use it.
export { initials } from './initials';
