'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { disconnect, loadConnection } from '@/lib/integrations/xero/connection';
import { monthCheck } from '@/lib/integrations/xero/reconcile';
import type { MonthLine } from '@/lib/integrations/xero/month';
import { scheduledSync } from '@/lib/jobs/handlers';
import { drainOutbox } from '@/lib/jobs/handlers';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';

const PAGE = '/admin/integrations/xero';

/** Runs one full sync step now (the scheduler does this every 15 minutes in the day and nightly). */
export async function syncNow(): Promise<void> {
  const member = await requirePerm('integrations.manage');
  const db = createAdminClient();
  await scheduledSync(db, 'full', 40_000);
  await drainOutbox(db, 10_000);
  await db.from('audit_log').insert({ org_id: member.orgId, actor_user: member.userId, action: 'xero.sync.manual', entity: 'org', entity_id: member.orgId });
  revalidatePath(PAGE);
  redirect(`${PAGE}?synced=1`);
}

export async function disconnectXero(): Promise<void> {
  const member = await requirePerm('integrations.manage');
  const db = createAdminClient();
  const conn = await loadConnection(db, member.orgId);
  if (conn) {
    await disconnect(db, conn.id);
    await db.from('audit_log').insert({ org_id: member.orgId, actor_user: member.userId, action: 'xero.disconnect', entity: 'xero_connection', entity_id: conn.tenantId });
  }
  revalidatePath(PAGE);
  redirect(PAGE);
}

export async function checkMonth(_prev: { lines?: MonthLine[]; error?: string; month?: string }, fd: FormData): Promise<{ lines?: MonthLine[]; error?: string; month?: string }> {
  const member = await requirePerm('integrations.manage');
  const month = String(fd.get('month') ?? '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: 'Choose a month.', month };
  try {
    const lines = await monthCheck(createAdminClient(), member.orgId, month);
    return { lines, month };
  } catch (e) {
    return { error: e instanceof Error && /not connected/.test(e.message) ? 'Xero is not connected.' : 'The check could not reach Xero. Try again shortly.', month };
  }
}
