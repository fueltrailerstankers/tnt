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

/** Connection state and last sync only. Token columns are never selected here. Service role, after the xero.read check. */
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

async function displayName(db: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data } = await db.from('profiles').select('full_name').eq('id', userId).maybeSingle();
    return (data?.full_name as string | null) ?? null;
  } catch {
    return null;
  }
}

export async function loadShellData(db: SupabaseClient, member: Member): Promise<ShellData> {
  const [tasks, userName, xero] = await Promise.all([
    can(member, 'tasks.read') ? taskCount(db, member.orgId) : Promise.resolve(0),
    displayName(db, member.userId),
    can(member, 'xero.read') ? xeroStatus(member.orgId) : Promise.resolve(null),
  ]);
  return { tasks, userName, xero };
}

// Kept for existing imports; the pure helper lives in lib/ui/initials.ts so client components can use it.
export { initials } from './initials';
