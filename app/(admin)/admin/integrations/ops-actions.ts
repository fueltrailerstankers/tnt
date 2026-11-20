'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import type { OpsResult } from '@/lib/integrations/ops';
import { replayEvent, retryJob, type OpsOutcome } from '@/lib/integrations/ops-run';
import { drainOutbox } from '@/lib/jobs/handlers';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';

// Per-event webhook Replay and outbox job Retry (Xero integration page, Tasks). integrations.manage first, Zod on
// the id, then the org-scoped runner (lib/integrations/ops-run.ts) with the service client. Results are toast copy.

const Id = z.guid();

function finish(r: OpsOutcome): OpsResult {
  if (r.queued) after(() => drainOutbox(createAdminClient(), 20_000).then(() => undefined, () => undefined));
  if (r.ok) {
    revalidatePath('/admin/integrations/xero');
    revalidatePath('/admin/tasks');
    revalidatePath('/admin');
  }
  return { ok: r.ok, message: r.message };
}

export async function replayEventAction(eventId: unknown): Promise<OpsResult> {
  const member = await requirePerm('integrations.manage');
  const id = Id.safeParse(eventId);
  if (!id.success) return { ok: false, message: 'This event could not be read. Reload the page and try again.' };
  return finish(await replayEvent(createAdminClient(), { orgId: member.orgId, userId: member.userId }, id.data));
}

export async function retryJobAction(jobId: unknown): Promise<OpsResult> {
  const member = await requirePerm('integrations.manage');
  const id = Id.safeParse(jobId);
  if (!id.success) return { ok: false, message: 'This job could not be read. Reload the page and try again.' };
  return finish(await retryJob(createAdminClient(), { orgId: member.orgId, userId: member.userId }, id.data, new Date()));
}
