import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// Postgres outbox drained by the scheduler (pg_cron + pg_net -> /api/jobs/outbox) and, opportunistically,
// right after a webhook. Jobs are short and idempotent; a job is claimed with a conditional update so two
// drains never run the same job. Failures back off and give up after MAX_ATTEMPTS.

export const MAX_ATTEMPTS = 5;

export interface Job {
  id: string;
  org_id: string | null;
  queue: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** What a handler may know about its run: the drain's deadline, so long jobs cap their own time budget to it. */
export interface JobContext {
  deadline: number;
}

export type Handler = (db: SupabaseClient, job: Job, ctx?: JobContext) => Promise<void>;

export async function enqueue(db: SupabaseClient, orgId: string | null, queue: string, payload: Record<string, unknown> = {}, opts: { uniquePending?: boolean } = {}) {
  if (opts.uniquePending) {
    // Pending for the same org: another org's pending job must not swallow this one.
    const q = db.from('outbox_jobs').select('id').eq('queue', queue).eq('status', 'pending');
    const { data } = await (orgId ? q.eq('org_id', orgId) : q.is('org_id', null)).limit(1);
    if (data?.length) return;
  }
  const { error } = await db.from('outbox_jobs').insert({ org_id: orgId, queue, payload });
  if (error) throw new Error('Could not enqueue job');
}

/** Runs due jobs until the deadline. Returns how many ran. */
export async function drain(db: SupabaseClient, handlers: Record<string, Handler>, deadline: number, limit = 25): Promise<{ ran: number; failed: number }> {
  const { data } = await db
    .from('outbox_jobs')
    .select('id, org_id, queue, payload, attempts')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(limit);
  let ran = 0;
  let failed = 0;
  for (const job of (data ?? []) as Job[]) {
    if (Date.now() > deadline) break;
    const { data: claimed } = await db
      .from('outbox_jobs')
      .update({ status: 'running', locked_at: new Date().toISOString(), attempts: job.attempts + 1 })
      .eq('id', job.id)
      .eq('status', 'pending')
      .select('id');
    if (!claimed?.length) continue;
    const handler = handlers[job.queue];
    try {
      if (!handler) throw new Error(`no handler for ${job.queue}`);
      await handler(db, job, { deadline });
      await db.from('outbox_jobs').update({ status: 'done', last_error: null }).eq('id', job.id);
      ran += 1;
    } catch (e) {
      failed += 1;
      const attempts = job.attempts + 1;
      const msg = e instanceof Error ? e.message.slice(0, 200) : 'job failed';
      await db.from('outbox_jobs').update({
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        run_at: new Date(Date.now() + 2 ** attempts * 30_000).toISOString(),
        last_error: msg,
      }).eq('id', job.id);
    }
  }
  return { ran, failed };
}

/** Releases jobs stuck in 'running' (the function died mid-job). */
export async function releaseStuck(db: SupabaseClient, olderThanMs = 10 * 60_000) {
  await db.from('outbox_jobs').update({ status: 'pending' }).eq('status', 'running').lt('locked_at', new Date(Date.now() - olderThanMs).toISOString());
}

/** Wraps a job in a job_runs row: started, finished, ok, processed, redacted error. */
export async function recordRun<T>(db: SupabaseClient, orgId: string | null, job: string, fn: () => Promise<{ processed: number; ok: boolean; error?: string; result: T }>): Promise<T> {
  const { data } = await db.from('job_runs').insert({ org_id: orgId, job }).select('id').single();
  try {
    const r = await fn();
    await db.from('job_runs').update({ finished_at: new Date().toISOString(), ok: r.ok, processed: r.processed, error: r.error ?? null }).eq('id', data?.id);
    return r.result;
  } catch (e) {
    await db.from('job_runs').update({ finished_at: new Date().toISOString(), ok: false, error: e instanceof Error ? e.message.slice(0, 200) : 'failed' }).eq('id', data?.id);
    throw e;
  }
}
