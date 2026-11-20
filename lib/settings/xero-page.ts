// View model for /admin/integrations/xero (HANDOFF XeroIntegration.dc.html). Pure: rows in, labels out.
// Everything shown comes from recorded rows (xero_connections bookkeeping columns, xero_sync_state, job_runs,
// outbox_jobs, integration_events, xero_action_runs). Token values are never read here, only their expiry.
import { entityLabel, jobErrorLabel } from '@/lib/tasks/jobs';
import { plural, stampLabel } from '@/lib/tasks/format';
import type { Tone } from '@/lib/ui/status';
import { dayTime, type TimeInput } from '@/lib/ui/time';
import { hasWriteScopes, PLAN_ONLY, WRITE_SCOPES, WRITES_TO_XERO, type ActionMode } from '@/lib/integrations/xero/write/modes';
import type { ActionName } from '@/lib/integrations/xero/write/types';

const DASH = '—';
const ms = (v: TimeInput) => (v === null || v === undefined || v === '' ? NaN : new Date(v).getTime());

export interface Meter {
  label: string;
  /** 0..100 for the bar; null when there is nothing to show. */
  pct: number | null;
  tone: Tone;
}

/** Xero access tokens last 30 minutes; the portal refreshes them on the next call. */
export const ACCESS_TOKEN_MINUTES = 30;
/** Xero refresh tokens expire 60 days after they were issued; each refresh issues a new one. */
export const REFRESH_TOKEN_DAYS = 60;
/** Warn from this many days left (design: "expiry alert to admin at 7 days"). */
export const REFRESH_WARN_DAYS = 7;

export function accessTokenMeter(expiresAt: TimeInput, now: TimeInput): Meter {
  const left = (ms(expiresAt) - ms(now)) / 60_000;
  if (!Number.isFinite(left)) return { label: DASH, pct: null, tone: 'gray' };
  if (left <= 0) return { label: 'Expired · refreshes on next call', pct: 0, tone: 'yellow' };
  const mins = Math.ceil(left);
  return { label: `${mins} min left · auto-refresh`, pct: Math.min(100, Math.round((left / ACCESS_TOKEN_MINUTES) * 100)), tone: 'green' };
}

/** Refresh token: issued at the last refresh (or connect), valid for 60 days. */
export function refreshTokenMeter(issuedAt: TimeInput, now: TimeInput): Meter & { daysLeft: number | null } {
  const ageDays = (ms(now) - ms(issuedAt)) / 86_400_000;
  if (!Number.isFinite(ageDays)) return { label: DASH, pct: null, tone: 'gray', daysLeft: null };
  const left = REFRESH_TOKEN_DAYS - ageDays;
  if (left <= 0) return { label: 'Expired · reconnect Xero', pct: 0, tone: 'red', daysLeft: 0 };
  const days = Math.floor(left);
  const label = days < 1 ? 'Less than a day left' : `${plural(days, 'day')} left`;
  const tone: Tone = left <= REFRESH_WARN_DAYS ? 'red' : left <= 14 ? 'yellow' : 'green';
  return { label, pct: Math.min(100, Math.round((left / REFRESH_TOKEN_DAYS) * 100)), tone, daysLeft: days };
}

/** Xero's limits per tenant: 60 calls a minute, 5,000 a day. Jobs back off under 10 a minute. */
export const RATE_MINUTE = 60;
export const RATE_DAY = 5000;
export const RATE_BACKOFF = 10;

const n = (x: number) => x.toLocaleString('en-US');

/**
 * Headroom from the last Xero response headers (rate_*_remaining, rate_seen_at). The minute window resets
 * 60 seconds later, so an older reading means the full minute is available again.
 */
export function rateMeters(r: { min: number | null; day: number | null; seenAt: TimeInput }, now: TimeInput): { minute: Meter; day: Meter; seen: string } {
  const seenMs = ms(r.seenAt);
  const age = ms(now) - seenMs;
  if (!Number.isFinite(seenMs)) {
    const none = { label: 'No calls yet', pct: null, tone: 'gray' as Tone };
    return { minute: none, day: none, seen: '' };
  }
  const minLeft = r.min === null ? null : age > 60_000 ? RATE_MINUTE : Math.max(0, Math.min(RATE_MINUTE, r.min));
  const dayLeft = r.day === null ? null : Math.max(0, Math.min(RATE_DAY, r.day));
  const meter = (left: number | null, limit: number, low: number): Meter =>
    left === null ? { label: DASH, pct: null, tone: 'gray' } : { label: `${n(left)} / ${n(limit)} left`, pct: Math.round((left / limit) * 100), tone: left < low ? 'red' : 'green' };
  return { minute: meter(minLeft, RATE_MINUTE, RATE_BACKOFF), day: meter(dayLeft, RATE_DAY, 500), seen: stampLabel(r.seenAt, now) };
}

// ---------------------------------------------------------------------------------------------------
// Last sync per entity
// ---------------------------------------------------------------------------------------------------
export interface SyncState {
  entity: string;
  backfill_done: boolean;
  pass: number;
  page: number;
  last_run_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  records_synced: number | string;
}

export interface EntityRow { entity: string; name: string; when: string; records: string; state: string; tone: Tone; detail: string | null }

/** Design order: Quotes, Invoices, Contacts, Payments, Attachments, then anything else the sync records. */
export const ENTITY_ORDER = ['quotes', 'invoices', 'contacts', 'payments', 'attachments', 'credit_notes'];

export function entityRows(states: readonly SyncState[], now: TimeInput): EntityRow[] {
  const order = (e: string) => { const i = ENTITY_ORDER.indexOf(e); return i < 0 ? ENTITY_ORDER.length : i; };
  return [...states].sort((a, b) => order(a.entity) - order(b.entity) || a.entity.localeCompare(b.entity)).map((s) => {
    const name = entityLabel(s.entity.replace(/_/g, ' '));
    const records = n(Number(s.records_synced) || 0);
    const when = s.last_ok_at ? stampLabel(s.last_ok_at, now) : 'Never';
    if (s.last_error) return { entity: s.entity, name, when, records, state: 'Failed', tone: 'red' as Tone, detail: jobErrorLabel(s.last_error) };
    if (!s.backfill_done) return { entity: s.entity, name, when, records, state: 'Backfilling', tone: 'teal' as Tone, detail: `pass ${s.pass + 1}, page ${s.page}` };
    if (!s.last_ok_at) return { entity: s.entity, name, when, records, state: 'Not synced', tone: 'gray' as Tone, detail: null };
    return { entity: s.entity, name, when, records, state: 'OK', tone: 'green' as Tone, detail: null };
  });
}

// ---------------------------------------------------------------------------------------------------
// Failures (24 h)
// ---------------------------------------------------------------------------------------------------
export interface FailedRun { id: number | string; job: string; started_at: string; error: string | null }
export interface FailedOutbox { id: string; queue: string; attempts: number; last_error: string | null; created_at: string; locked_at: string | null }
/** `replayable` is decided by the loader with canReplay (lib/integrations/ops.ts), which this client-safe module does not import. */
export interface FailedEvent { id: string; received_at: string; status: string; attempts: number; error: string | null; payload?: unknown; replayable?: boolean }

/**
 * retry: re-runs the sync (the existing Sync now action).
 * retry-job: re-queues that failed outbox job in place (retryJobAction; `target` is the job id).
 * replay: re-queues processing of that stored webhook event from its raw payload (replayEventAction; `target` is
 * the event id). Both are idempotent: the handlers only read Xero and upsert the mirror.
 */
export type FailureAction = 'retry' | 'retry-job' | 'replay' | null;

export interface FailureItem { key: string; job: string; error: string; meta: string; action: FailureAction; target: string | null; at: string }

const DAY_MS = 86_400_000;

/** A Xero event's category and type from its stored payload ("INVOICE", "UPDATE"); null when the payload has none. */
export function eventKind(payload: unknown): { category: string | null; type: string | null } {
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const word = (v: unknown) => (typeof v === 'string' && /^[A-Za-z_]{1,40}$/.test(v) ? v.toUpperCase() : null);
  return { category: word(p.eventCategory), type: word(p.eventType) };
}

export function failureItems(input: { states: readonly SyncState[]; runs: readonly FailedRun[]; outbox: readonly FailedOutbox[]; events: readonly FailedEvent[] }, now: TimeInput): FailureItem[] {
  const since = ms(now) - DAY_MS;
  const recent = (t: TimeInput) => ms(t) >= since;
  const items: FailureItem[] = [];
  for (const s of input.states) {
    if (!s.last_error) continue;
    items.push({ key: `sync-${s.entity}`, job: `xero.sync · ${s.entity}`, error: jobErrorLabel(s.last_error), meta: s.last_run_at ? stampLabel(s.last_run_at, now) : DASH, action: 'retry', target: null, at: s.last_run_at ?? '' });
  }
  for (const r of input.runs) {
    if (!recent(r.started_at)) continue;
    const sync = r.job.startsWith('xero.sync');
    items.push({ key: `run-${r.id}`, job: r.job, error: jobErrorLabel(r.error), meta: `${stampLabel(r.started_at, now)} · run #${r.id}`, action: sync ? 'retry' : null, target: null, at: r.started_at });
  }
  for (const j of input.outbox) {
    const at = j.locked_at ?? j.created_at;
    if (!recent(at)) continue;
    const webhook = j.queue === 'xero.fetch';
    items.push({
      key: `job-${j.id}`, job: webhook ? 'webhook · xero.fetch' : j.queue, error: jobErrorLabel(j.last_error),
      meta: `${stampLabel(at, now)} · ${plural(j.attempts, 'attempt')}`, action: 'retry-job', target: j.id, at,
    });
  }
  for (const e of input.events) {
    if (!recent(e.received_at)) continue;
    const kind = eventKind(e.payload);
    const ok = e.replayable === true;
    items.push({
      key: `event-${e.id}`, job: `webhook · ${(kind.category ?? 'event').toLowerCase()}`, error: e.error ? jobErrorLabel(e.error) : e.status === 'queued' ? 'Not processed yet' : 'Failed',
      meta: `${stampLabel(e.received_at, now)} · received`, action: ok ? 'replay' : null, target: ok ? e.id : null, at: e.received_at,
    });
  }
  return items.sort((a, b) => (ms(b.at) || 0) - (ms(a.at) || 0));
}

// ---------------------------------------------------------------------------------------------------
// Webhook events (recent, any status)
// ---------------------------------------------------------------------------------------------------
export interface WebhookEvent { id: string; received_at: string; status: string; attempts: number; error: string | null; payload: unknown; replayable: boolean }

export interface WebhookEventRow { id: string; kind: string; when: string; status: string; tone: Tone; detail: string | null; replayable: boolean }

const EVENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  received: { label: 'Received', tone: 'gray' },
  queued: { label: 'Queued', tone: 'yellow' },
  processed: { label: 'Processed', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  ignored: { label: 'Ignored', tone: 'gray' },
};

/** Rows for the "Webhook events" card: kind from the stored payload (resource ids are never shown), status, Replay when allowed. */
export function webhookEventRows(events: readonly WebhookEvent[], now: TimeInput): WebhookEventRow[] {
  return events.map((e) => {
    const k = eventKind(e.payload);
    const st = EVENT_STATUS[e.status] ?? { label: e.status, tone: 'gray' as Tone };
    return {
      id: e.id,
      kind: [k.category, k.type].filter(Boolean).join(' · ') || 'Event',
      when: stampLabel(e.received_at, now) || DASH,
      status: st.label,
      tone: st.tone,
      detail: e.error ? jobErrorLabel(e.error) : null,
      replayable: e.replayable,
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// Write actions
// ---------------------------------------------------------------------------------------------------
export const MODE_LABEL: Record<ActionMode, string> = { off: 'Off', dry_run: 'Dry-run', live: 'Live' };
export const MODE_TONE: Record<ActionMode, Tone> = { off: 'gray', dry_run: 'yellow', live: 'red' };

/** What starts each action (docs/M3.md). */
export const ACTION_TRIGGER: Record<ActionName, string> = {
  'deal.import_quote': 'DEAL submitted',
  'rfi.create_invoice': 'Request for Invoice submitted or updated',
  'delivery.update_invoice': 'Delivery Note submitted or updated',
  'release.on_paid': 'Xero invoice fully paid',
  'invoice.merge_attachments': 'On demand (plan only)',
};

export const ACTION_ABOUT: Record<ActionName, string> = {
  'deal.import_quote': 'DEAL Submit: copy quote lines 1-8 (description, item code) and the total from Xero into the DEAL.',
  'rfi.create_invoice': 'RFI Submit/Update: contact, quote SENT > ACCEPTED > INVOICED, invoice from the quote (once), attach RFI PDF and deposits.',
  'delivery.update_invoice': 'Delivery Note Submit/Update: VIN to the invoice Reference, attach delivery PDF, ID, payments, NATIS, photos, RFI PDF.',
  'release.on_paid': 'Invoice fully paid: create or update the RELEASE FORM entry and email the branches with the invoice and release PDFs.',
  'invoice.merge_attachments': "On demand: plan merging an invoice's attachments into one PDF (plan only; needs pdf-lib).",
};

export interface RunStatRow { action: string; mode: string; status: string; created_at: string }

/** "Last 7 days" cell: "3 sent · 1 failed", "18 dry runs · 2 failed", "4 skipped (off)", "No runs". */
export function actionStats(runs: readonly RunStatRow[], action: string, now: TimeInput): string {
  const since = ms(now) - 7 * DAY_MS;
  const mine = runs.filter((r) => r.action === action && ms(r.created_at) >= since);
  if (!mine.length) return 'No runs';
  const live = mine.filter((r) => r.mode === 'live');
  const dry = mine.filter((r) => r.mode === 'dry_run');
  const off = mine.filter((r) => r.mode === 'off');
  const failed = mine.filter((r) => r.status === 'failed').length;
  const parts: string[] = [];
  const sent = live.filter((r) => r.status === 'succeeded' || r.status === 'sent').length;
  if (live.length) parts.push(`${sent} sent`);
  if (dry.length) parts.push(plural(dry.filter((r) => r.status !== 'skipped').length, 'dry run'));
  const skipped = mine.filter((r) => r.status === 'skipped').length;
  if (skipped) parts.push(`${skipped} skipped${off.length === skipped ? ' (off)' : ''}`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(' · ');
}

export interface DryRunRow { id: string; action: string; mode: string; status: string; idempotency_key: string; created_at: string; planned_requests: unknown }

/** The dry run the diff viewer shows: the chosen run if it is a dry run of that action, else the latest one with requests. */
export function pickDryRun<T extends DryRunRow>(runs: readonly T[], action: string, runId?: string | null): T | null {
  const dry = runs.filter((r) => r.action === action && r.mode === 'dry_run' && r.status !== 'skipped');
  if (runId) {
    const chosen = dry.find((r) => r.id === runId);
    if (chosen) return chosen;
  }
  return dry.find((r) => Array.isArray(r.planned_requests) && r.planned_requests.length > 0) ?? dry[0] ?? null;
}

/** Run header: "28 Oct 13:20 SAST". */
export const runStamp = (at: TimeInput, now: TimeInput) => `${dayTime(at, now)} SAST`;

/** Why Live cannot be chosen now, with the same rules as checkSwitch (the server re-checks on every switch). */
export function liveBlockedReason(action: ActionName, conn: { status: string; scopes: readonly string[] } | null): string | null {
  if (PLAN_ONLY[action]) return 'not built yet (this action only plans).';
  if (!WRITES_TO_XERO[action]) return null;
  if (!conn || conn.status !== 'connected') return 'connect Xero first.';
  if (!hasWriteScopes(conn.scopes)) return `reconnect Xero with the write scopes (${WRITE_SCOPES.join(', ')}).`;
  return null;
}

