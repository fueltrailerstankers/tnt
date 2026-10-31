// Settings > Job runs. Pure. job_runs (0004) holds ids, job names, times, counts and an already-redacted error.
// The view shows ids and counts only; error text also goes through jobErrorLabel (emails and long numbers masked,
// clipped), so a bad writer can still never put personal data on screen.
import { jobErrorLabel } from '@/lib/tasks/jobs';
import type { Tone } from '@/lib/ui/status';

export interface JobRunRow {
  id: number | string;
  job: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  processed: number | null;
  error: string | null;
}

export type JobRunState = 'Running' | 'Succeeded' | 'Failed' | 'Stalled';

export interface JobRunView {
  id: string;
  job: string;
  startedAt: string;
  duration: string;
  state: JobRunState;
  tone: Tone;
  processed: string;
  error: string | null;
}

/** Older than this and still unfinished: the function died mid-run. */
export const STALL_MS = 15 * 60_000;

export function durationLabel(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  return `${m} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export function jobRunView(r: JobRunRow, now: number): JobRunView {
  const running = r.ok === null && !r.finished_at;
  const stalled = running && now - new Date(r.started_at).getTime() > STALL_MS;
  const state: JobRunState = stalled ? 'Stalled' : running ? 'Running' : r.ok ? 'Succeeded' : 'Failed';
  const tone: Tone = state === 'Succeeded' ? 'green' : state === 'Running' ? 'teal' : state === 'Stalled' ? 'yellow' : 'red';
  return {
    id: `#${r.id}`,
    job: r.job,
    startedAt: r.started_at,
    duration: durationLabel(r.started_at, r.finished_at),
    state,
    tone,
    processed: String(r.processed ?? 0),
    error: r.ok === false || r.error ? (r.error ? jobErrorLabel(r.error) : 'Failed') : null,
  };
}

export const JOB_STATES = [
  { value: 'all', label: 'All' },
  { value: 'failed', label: 'Failed' },
  { value: 'running', label: 'Running' },
  { value: 'succeeded', label: 'Succeeded' },
] as const;
export type JobStateFilter = (typeof JOB_STATES)[number]['value'];

export const parseJobState = (v: unknown): JobStateFilter =>
  JOB_STATES.some((s) => s.value === v) ? (v as JobStateFilter) : 'all';

export const JOB_PAGE_SIZE = 50;

/** ?page= as a 1-based page number (1 when missing or invalid, capped). */
export function parsePage(v: unknown): number {
  const n = typeof v === 'string' && /^\d{1,4}$/.test(v) ? Number(v) : 1;
  return Math.min(Math.max(n, 1), 1000);
}
