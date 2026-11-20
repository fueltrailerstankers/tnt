import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { enqueue } from '@/lib/jobs/outbox';
import { replayPlan, replayRefusedMessage, retryDecision, retryRefusedMessage, type OpsResult, type StoredEvent } from './ops';

// Applies Replay and Retry (rules in ./ops.ts). Callers have already passed requirePerm('integrations.manage') and
// pass the service client (integration_events, outbox_jobs are service-only tables) with the member's org: every
// read and write is scoped to that org, so another org's id reads as "not found". Audit rows hold ids and codes only.

export interface OpsActor {
  orgId: string;
  userId: string;
}

export interface OpsOutcome extends OpsResult {
  /** Whether a job was queued or re-queued (the caller drains the outbox soon when true). */
  queued: boolean;
}

const fail = (message: string): OpsOutcome => ({ ok: false, message, queued: false });

/**
 * Re-queues processing of one stored webhook event from its raw payload. A job already pending or running for the
 * event is reused (nothing new is queued). The event row is claimed with a conditional update on the status read,
 * so a concurrent change (the job finishing, another replay) is noticed instead of overwritten.
 */
export async function replayEvent(db: SupabaseClient, actor: OpsActor, eventId: string): Promise<OpsOutcome> {
  const { data: ev, error } = await db.from('integration_events').select('id, org_id, source, status, payload')
    .eq('id', eventId).eq('org_id', actor.orgId).maybeSingle();
  if (error) return fail('The event could not be read. Try again.');
  const plan = replayPlan((ev as StoredEvent | null) ?? null);
  if (!plan.ok) return fail(replayRefusedMessage(plan.reason));
  const prior = (ev as StoredEvent).status;

  const { data: open, error: openError } = await db.from('outbox_jobs').select('id')
    .eq('org_id', actor.orgId).eq('queue', plan.queue).eq('payload->>event_id', eventId).in('status', ['pending', 'running']).limit(1);
  if (openError) return fail('The event could not be queued. Try again.');
  if (open?.length) return { ok: true, message: 'This event is already queued to be processed.', queued: false };

  const { data: claimed, error: claimError } = await db.from('integration_events').update({ status: 'queued', error: null })
    .eq('id', eventId).eq('org_id', actor.orgId).eq('status', prior).select('id');
  if (claimError) return fail('The event could not be queued. Try again.');
  if (!claimed?.length) return fail('This event changed while you were looking at it. Reload the page.');

  try {
    await enqueue(db, actor.orgId, plan.queue, plan.payload);
  } catch {
    // Put the status back so the list still shows the event as it was.
    await db.from('integration_events').update({ status: prior }).eq('id', eventId).eq('org_id', actor.orgId).eq('status', 'queued');
    return fail('The event could not be queued. Try again.');
  }
  await db.from('audit_log').insert({
    org_id: actor.orgId, actor_user: actor.userId, action: 'integration.replay', entity: 'integration_event', entity_id: eventId,
    meta: { source: (ev as StoredEvent).source, queue: plan.queue, from: prior },
  });
  return { ok: true, message: 'Event queued for replay. It is processed again from the stored copy.', queued: true };
}

/** Re-queues one failed outbox job in place (same row, attempts reset). */
export async function retryJob(db: SupabaseClient, actor: OpsActor, jobId: string, now: Date): Promise<OpsOutcome> {
  const { data: job, error } = await db.from('outbox_jobs').select('id, queue, status, attempts')
    .eq('id', jobId).eq('org_id', actor.orgId).maybeSingle();
  if (error) return fail('The job could not be read. Try again.');
  const decision = retryDecision(job ? { id: job.id as string, status: job.status as string, attempts: Number(job.attempts ?? 0) } : null, now);
  if (!decision.ok) return fail(retryRefusedMessage(decision.reason));

  const { data: reset, error: resetError } = await db.from('outbox_jobs').update(decision.update)
    .eq('id', jobId).eq('org_id', actor.orgId).eq('status', 'failed').select('id');
  if (resetError) return fail('The job could not be retried. Try again.');
  if (!reset?.length) return fail(retryRefusedMessage('changed'));

  await db.from('audit_log').insert({
    org_id: actor.orgId, actor_user: actor.userId, action: 'job.retry', entity: 'outbox_job', entity_id: jobId,
    meta: { queue: job!.queue, attempts: Number(job!.attempts ?? 0) },
  });
  return { ok: true, message: 'Job queued again. It runs on the next outbox drain.', queued: true };
}
