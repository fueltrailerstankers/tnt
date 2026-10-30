// Home "Xero sync health" tile, "Sync by entity" card and the phone alert banner. Pure.
import type { Tone } from '@/lib/ui/status';
import { clock, type TimeInput } from '@/lib/ui/time';
import { plural, stampLabel } from '@/lib/tasks/format';
import { entityLabel, entitySingular, errorCode, jobErrorLabel, SYNC_ENTITIES } from '@/lib/tasks/jobs';

export interface SyncStateRow {
  entity: string;
  last_run_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
}

export interface XeroHealthInput {
  /** Latest connection row (status and access-token expiry only); null when the org never connected. */
  connection: { status: string; expiresAt: string | null } | null;
  /** xero_sync_state rows; null when the read failed. */
  states: SyncStateRow[] | null;
  /** Failed xero.* job_runs in the last 24 h, newest first; null when the read failed. */
  failures: Array<{ error: string | null }> | null;
}

export interface HealthRow {
  label: string;
  value: string;
  danger?: boolean;
}

export type SyncDot = 'ok' | 'failed' | 'never';

export interface SyncRowView {
  entity: string;
  label: string;
  dot: SyncDot;
  when: string;
}

export interface XeroHealth {
  connected: boolean;
  chip: { label: string; tone: Tone };
  rows: HealthRow[];
  sync: SyncRowView[];
  /** Phone banner text, or null when everything is fine. */
  banner: string | null;
}

const DASH = '—';

/** "in 22 min · auto-refresh". Access tokens live 30 minutes and are refreshed on the next call. */
export function tokenExpiry(expiresAt: TimeInput, now: TimeInput): string {
  if (!expiresAt || !now) return DASH;
  const exp = new Date(expiresAt).getTime();
  const at = new Date(now).getTime();
  if (Number.isNaN(exp) || Number.isNaN(at)) return DASH;
  const mins = Math.ceil((exp - at) / 60_000);
  if (mins <= 0) return 'expired · refreshes on next call';
  if (mins < 60) return `in ${mins} min · auto-refresh`;
  return `in ${Math.floor(mins / 60)} h · auto-refresh`;
}

export function syncRows(states: SyncStateRow[] | null, now: TimeInput): SyncRowView[] {
  return SYNC_ENTITIES.map((entity) => {
    const s = states?.find((x) => x.entity === entity);
    const label = entityLabel(entity);
    if (!states) return { entity, label, dot: 'never' as const, when: DASH };
    if (s?.last_error) return { entity, label, dot: 'failed' as const, when: `Failed ${clock(s.last_run_at) || DASH} · ${errorCode(s.last_error)}` };
    if (s?.last_ok_at) return { entity, label, dot: 'ok' as const, when: stampLabel(s.last_ok_at, now) };
    return { entity, label, dot: 'never' as const, when: 'Not synced yet' };
  });
}

export function xeroHealth(input: XeroHealthInput, now: TimeInput): XeroHealth {
  const connected = input.connection?.status === 'connected';
  const states = input.states;
  const errored = (states ?? []).filter((s) => s.last_error)
    .sort((a, b) => (SYNC_ENTITIES as readonly string[]).indexOf(a.entity) - (SYNC_ENTITIES as readonly string[]).indexOf(b.entity));
  const failures = input.failures;
  const failureCount = failures?.length ?? 0;
  const issues = failureCount || errored.length;

  const chip = !connected
    ? { label: 'Not connected', tone: 'red' as const }
    : issues
      ? { label: plural(issues, 'failure'), tone: 'yellow' as const }
      : { label: 'Healthy', tone: 'green' as const };

  const lastRun = (states ?? []).map((s) => s.last_run_at).filter((x): x is string => !!x).sort().pop() ?? null;
  const rows: HealthRow[] = [
    { label: 'Last sync', value: !connected || !states ? DASH : lastRun ? stampLabel(lastRun, now) : 'Not synced yet' },
    { label: 'Token expiry', value: connected ? tokenExpiry(input.connection?.expiresAt, now) : DASH },
    failures === null
      ? { label: 'Failures 24 h', value: DASH }
      : failureCount
        ? { label: 'Failures 24 h', value: `${failureCount} (${jobErrorLabel(failures[0].error, 'short')})`, danger: true }
        : { label: 'Failures 24 h', value: '0' },
  ];

  let banner: string | null = null;
  if (!connected) banner = 'Xero is not connected';
  else if (errored.length) {
    const s = errored[0];
    const at = clock(s.last_run_at);
    banner = `Xero ${entitySingular(s.entity)} sync failed${at ? ` at ${at}` : ''}`;
  }

  return { connected, chip, rows, sync: syncRows(states, now), banner };
}
