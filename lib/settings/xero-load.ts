import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConnection, type Connection } from '@/lib/integrations/xero/connection';
import { parseMode, resolveMode, settingKey, type ActionMode, type ResolvedMode } from '@/lib/integrations/xero/write/modes';
import { ACTIONS, type ActionName } from '@/lib/integrations/xero/write/types';
import { liveBlockedReason, type DryRunRow, type FailedEvent, type FailedOutbox, type FailedRun, type RunStatRow, type SyncState } from './xero-page';

// Reads for /admin/integrations/xero and /actions. Callers check the permission first (requirePerm) and pass the
// service client: xero_connections, job_runs, outbox_jobs and integration_events are service-only tables. Token
// columns are never selected here; only expiry and bookkeeping columns.

const DAY = 86_400_000;

export interface ConnectionInfo {
  conn: Connection | null;
  lastRefreshedAt: string | null;
  connectedAt: string | null;
  connectedBy: string | null;
  rate: { min: number | null; day: number | null; seenAt: string | null };
}

export async function loadConnectionInfo(db: SupabaseClient, orgId: string): Promise<ConnectionInfo> {
  const conn = await loadConnection(db, orgId);
  if (!conn) return { conn, lastRefreshedAt: null, connectedAt: null, connectedBy: null, rate: { min: null, day: null, seenAt: null } };
  const { data } = await db.from('xero_connections')
    .select('last_refreshed_at, connected_at, connected_by, rate_min_remaining, rate_day_remaining, rate_seen_at')
    .eq('id', conn.id).maybeSingle();
  let connectedBy: string | null = null;
  if (data?.connected_by) {
    const { data: p } = await db.from('profiles').select('full_name').eq('id', data.connected_by).maybeSingle();
    connectedBy = (p?.full_name as string | null) ?? null;
  }
  return {
    conn,
    lastRefreshedAt: data?.last_refreshed_at ?? null,
    connectedAt: data?.connected_at ?? null,
    connectedBy,
    rate: { min: data?.rate_min_remaining ?? null, day: data?.rate_day_remaining ?? null, seenAt: data?.rate_seen_at ?? null },
  };
}

export interface HealthData {
  states: SyncState[];
  runs: FailedRun[];
  outbox: FailedOutbox[];
  events: FailedEvent[];
  lastEventAt: string | null;
  eventsDay: number;
  queued: number;
}

export async function loadHealth(db: SupabaseClient, orgId: string, now: number): Promise<HealthData> {
  const since = new Date(now - DAY).toISOString();
  const stuck = new Date(now - 15 * 60_000).toISOString();
  const [states, runs, outbox, failedEvents, stuckEvents, last, day, queued] = await Promise.all([
    db.from('xero_sync_state').select('entity, backfill_done, pass, page, last_run_at, last_ok_at, last_error, records_synced').eq('org_id', orgId),
    db.from('job_runs').select('id, job, started_at, error').eq('org_id', orgId).like('job', 'xero.%').eq('ok', false).gte('started_at', since)
      .order('started_at', { ascending: false }).limit(20),
    db.from('outbox_jobs').select('id, queue, attempts, last_error, created_at, locked_at').eq('org_id', orgId).like('queue', 'xero.%').eq('status', 'failed')
      .gte('created_at', new Date(now - 7 * DAY).toISOString()).order('created_at', { ascending: false }).limit(20),
    db.from('integration_events').select('id, received_at, status, attempts, error').eq('org_id', orgId).eq('source', 'xero').eq('status', 'failed')
      .gte('received_at', since).order('received_at', { ascending: false }).limit(20),
    db.from('integration_events').select('id, received_at, status, attempts, error').eq('org_id', orgId).eq('source', 'xero').eq('status', 'queued')
      .gte('received_at', since).lt('received_at', stuck).order('received_at', { ascending: false }).limit(20),
    db.from('integration_events').select('received_at').eq('org_id', orgId).eq('source', 'xero').order('received_at', { ascending: false }).limit(1),
    db.from('integration_events').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('source', 'xero').gte('received_at', since),
    db.from('outbox_jobs').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'pending'),
  ]);
  return {
    states: (states.data ?? []) as SyncState[],
    runs: (runs.data ?? []) as FailedRun[],
    outbox: (outbox.data ?? []) as FailedOutbox[],
    events: [...(failedEvents.data ?? []), ...(stuckEvents.data ?? [])].map((e) => ({ ...e, category: null })) as FailedEvent[],
    lastEventAt: last.data?.[0]?.received_at ?? null,
    eventsDay: day.count ?? 0,
    queued: queued.count ?? 0,
  };
}

export interface ActionInfo {
  action: ActionName;
  setting: ActionMode;
  resolved: ResolvedMode;
  liveBlocked: string | null;
}

export async function loadActions(db: SupabaseClient, orgId: string, conn: Connection | null, now: number) {
  const [{ data: settings }, { data: runs }] = await Promise.all([
    db.from('app_settings').select('key, value').eq('org_id', orgId).like('key', 'xero.action.%'),
    db.from('xero_action_runs').select('id, action, mode, status, idempotency_key, created_at')
      .eq('org_id', orgId).gte('created_at', new Date(now - 30 * DAY).toISOString()).order('created_at', { ascending: false }).limit(500),
  ]);
  const value = (a: ActionName) => settings?.find((s) => s.key === settingKey(a))?.value;
  const actions: ActionInfo[] = ACTIONS.map((a) => ({ action: a, setting: parseMode(value(a)), resolved: resolveMode(a, value(a), conn), liveBlocked: liveBlockedReason(a, conn) }));
  return { actions, runs: (runs ?? []) as Array<RunStatRow & { id: string; idempotency_key: string }> };
}

/** One run's redacted planned requests (stored redacted by the runner). */
export async function loadRunRequests(db: SupabaseClient, orgId: string, runId: string): Promise<DryRunRow | null> {
  const { data } = await db.from('xero_action_runs').select('id, action, mode, status, idempotency_key, created_at, planned_requests')
    .eq('org_id', orgId).eq('id', runId).maybeSingle();
  return (data as DryRunRow | null) ?? null;
}
