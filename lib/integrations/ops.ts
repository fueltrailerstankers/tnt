// Integration operations: per-event webhook Replay and outbox job Retry. Pure: rows in, plans and copy out.
// The server actions (lib/integrations/ops-run.ts) read the row in the caller's org after requirePerm, ask these
// rules what to do, and apply the result with conditional updates.
//
// Replay re-queues processing of the event's STORED raw payload. It never re-verifies a signature (the payload was
// verified when it arrived and is not re-sent) and never calls a Xero write: `xero.fetch` reads the record (GET via
// XeroReader) and upserts the mirror; `leads.intake` resumes the lead by its source id (createLead), so neither
// duplicates anything when run again.
//
// Retry resets the SAME failed outbox row to pending (no new row): attempts back to 0 so it gets the normal backoff
// budget again, due now, lock and error cleared. The handler it runs is the one the outbox already retries
// automatically, so it is idempotent by the outbox contract (lib/jobs/outbox.ts).
import { entityFor, XeroEventSchema } from '@/lib/integrations/xero/webhook';

// ------------------------------------------------------------------------------------------------
// Replay
// ------------------------------------------------------------------------------------------------

/** Sources whose stored events can be replayed, and the outbox queue that processes them. */
export const REPLAY_QUEUES = { xero: 'xero.fetch', leads: 'leads.intake' } as const;
export type ReplaySource = keyof typeof REPLAY_QUEUES;

/** Event statuses a replay accepts. `ignored` events were never meant to be processed (unknown org or category, invalid body). */
export const REPLAYABLE_EVENT_STATUSES = ['received', 'queued', 'failed', 'processed'] as const;

export interface StoredEvent {
  id: string;
  org_id: string | null;
  source: string;
  status: string;
  payload: unknown;
}

export type ReplayRefusal = 'not_found' | 'unsupported_source' | 'ignored' | 'no_org' | 'unreadable' | 'not_handled';

export type ReplayPlan =
  | { ok: true; queue: string; payload: Record<string, unknown> }
  | { ok: false; reason: ReplayRefusal };

export function isReplaySource(s: string): s is ReplaySource {
  return Object.prototype.hasOwnProperty.call(REPLAY_QUEUES, s);
}

/** Whether a stored event can be replayed, and the job that would process it. */
export function replayPlan(ev: StoredEvent | null): ReplayPlan {
  if (!ev) return { ok: false, reason: 'not_found' };
  if (!isReplaySource(ev.source)) return { ok: false, reason: 'unsupported_source' };
  if (!(REPLAYABLE_EVENT_STATUSES as readonly string[]).includes(ev.status)) return { ok: false, reason: 'ignored' };
  if (!ev.org_id) return { ok: false, reason: 'no_org' };
  if (ev.source === 'leads') return { ok: true, queue: REPLAY_QUEUES.leads, payload: { event_id: ev.id } };
  const parsed = XeroEventSchema.safeParse(ev.payload);
  if (!parsed.success) return { ok: false, reason: 'unreadable' };
  const entity = entityFor(parsed.data);
  if (!entity) return { ok: false, reason: 'not_handled' };
  return { ok: true, queue: REPLAY_QUEUES.xero, payload: { entity, id: parsed.data.resourceId, event_id: ev.id } };
}

/** Whether the list shows a Replay button for this row (same rule as the action). */
export function canReplay(ev: StoredEvent): boolean {
  return replayPlan(ev).ok;
}

const REPLAY_REFUSED: Record<ReplayRefusal, string> = {
  not_found: 'This event no longer exists. Reload the page.',
  unsupported_source: 'Events from this source cannot be replayed.',
  ignored: 'This event was ignored when it arrived, so there is nothing to replay.',
  no_org: 'This event did not match a connected organisation, so there is nothing to replay.',
  unreadable: 'This event could not be read, so it cannot be replayed.',
  not_handled: 'The portal does not process this kind of event.',
};

export function replayRefusedMessage(reason: ReplayRefusal): string {
  return REPLAY_REFUSED[reason];
}

// ------------------------------------------------------------------------------------------------
// Retry
// ------------------------------------------------------------------------------------------------

/** Job statuses Retry accepts. The outbox marks a job `failed` once it has used up MAX_ATTEMPTS (there is no separate dead state). */
export const RETRYABLE_JOB_STATUSES = ['failed'] as const;

export interface OutboxRow {
  id: string;
  status: string;
  attempts: number;
}

export interface RetryUpdate {
  status: 'pending';
  attempts: 0;
  run_at: string;
  locked_at: null;
  last_error: null;
}

export type RetryRefusal = 'not_found' | 'not_failed';
export type RetryDecision = { ok: true; update: RetryUpdate } | { ok: false; reason: RetryRefusal };

/** Whether a job can be retried and the update that re-queues it (applied only while it is still `failed`). */
export function retryDecision(job: OutboxRow | null, now: Date): RetryDecision {
  if (!job) return { ok: false, reason: 'not_found' };
  if (!(RETRYABLE_JOB_STATUSES as readonly string[]).includes(job.status)) return { ok: false, reason: 'not_failed' };
  return { ok: true, update: { status: 'pending', attempts: 0, run_at: now.toISOString(), locked_at: null, last_error: null } };
}

export function retryRefusedMessage(reason: RetryRefusal | 'changed'): string {
  if (reason === 'not_found') return 'This job no longer exists. Reload the page.';
  return 'This job is no longer failed: it was retried or finished already. Reload the page.';
}

/** Result of a Replay or Retry for the client (toast copy only; never ids, payloads or personal data). */
export interface OpsResult {
  ok: boolean;
  message: string;
}
