import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadForms } from '@/lib/forms/forms';
import { can, type Member } from '@/lib/security/can';
import type { EntryData } from '@/lib/spec/values';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  buildTasks, INSPECTION_SLUG, STORE_ROOM_SLUG, STORE_ROOM_TASK_STATUS, taskPerms, visibleFilters,
  type InspectionInput, type LeadInput, type OutboxFailure, type StoreRoomInput, type SyncFailure, type TaskCategory,
  type TaskFilter, type TaskPerms, type TaskRow,
} from './build';
import { SYNC_ENTITIES } from './jobs';
import { memberNames } from './names';

export interface LoadedTasks {
  rows: TaskRow[];
  perms: TaskPerms;
  filters: TaskFilter[];
  /** Categories whose read failed: the list shows what it could load and says what is missing. */
  failed: TaskCategory[];
}

const LIMIT = 200;

type EntryRow = {
  id: string; number: number; status: string; data: EntryData | null; updated_at: string; submitted_at: string | null; created_by: string | null;
};
type EventRow = { entry_id: string; action: string; from_status: string | null; to_status: string | null; actor_user: string | null; created_at: string };

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Newest first, per entry. Through the caller's RLS client (members may read their org's timeline). */
async function eventsFor(db: SupabaseClient, ids: string[]): Promise<Map<string, EventRow[]>> {
  const by = new Map<string, EventRow[]>();
  for (const part of chunks(ids, 100)) {
    const { data, error } = await db.from('entry_events').select('entry_id, action, from_status, to_status, actor_user, created_at')
      .in('entry_id', part).order('created_at', { ascending: false }).limit(2000);
    if (error) throw new Error('entry_events');
    for (const e of (data ?? []) as EventRow[]) by.set(e.entry_id, [...(by.get(e.entry_id) ?? []), e]);
  }
  return by;
}

/**
 * When the entry reached its current status: the latest timeline event that moved it there (edits that keep the
 * status do not count); without one (imported entries), the submit time for the first status after submit, else the
 * last update.
 */
function waitingSince(e: EntryRow, events: EventRow[] | undefined): string {
  const firstAfterSubmit = e.status === 'Submitted' || e.status === STORE_ROOM_TASK_STATUS;
  return events?.find((x) => x.to_status === e.status && x.from_status !== e.status)?.created_at
    ?? (firstAfterSubmit ? e.submitted_at : null)
    ?? e.updated_at;
}

/**
 * Everything waiting on the member, already filtered to what they may act on. Entries, timeline, leads and
 * sync state come through the caller's RLS client. outbox_jobs and job_runs are service-role tables: they are read
 * only after can(member, 'integrations.manage') and always filtered by the member's org. Each source fails soft.
 */
export async function loadTasks(member: Member, now: Date, userDb?: SupabaseClient): Promise<LoadedTasks> {
  const perms = taskPerms(member);
  const filters = visibleFilters(perms);
  if (!can(member, 'tasks.read')) return { rows: [], perms, filters: ['all'], failed: [] };
  const db = userDb ?? (await createClient());
  const failed: TaskCategory[] = [];
  const orgId = member.orgId;

  const entries = async () => {
    const forms = await loadForms(db, orgId);
    const insp = forms.find((f) => f.slug === INSPECTION_SLUG);
    const store = forms.find((f) => f.slug === STORE_ROOM_SLUG);
    const statuses = [perms.review ? 'Submitted' : '', perms.approve ? 'Reviewed' : ''].filter(Boolean);
    const cols = 'id, number, status, data, updated_at, submitted_at, created_by';
    const [i, s] = await Promise.all([
      insp && statuses.length
        ? db.from('entries').select(cols).eq('form_id', insp.id).in('status', statuses).order('updated_at', { ascending: true }).limit(LIMIT)
        : null,
      store && perms.storeRoom
        ? db.from('entries').select(cols).eq('form_id', store.id).eq('status', STORE_ROOM_TASK_STATUS).order('updated_at', { ascending: true }).limit(LIMIT)
        : null,
    ]);
    if (i?.error) failed.push('inspections');
    if (s?.error) failed.push('store-room');
    const iRows = (i?.data ?? []) as EntryRow[];
    const sRows = (s?.data ?? []) as EntryRow[];
    const events = await eventsFor(db, [...iRows, ...sRows].map((e) => e.id));
    const reviewer = (id: string) => events.get(id)?.find((x) => x.action === 'MarkReviewed')?.actor_user ?? null;
    const names = await memberNames(orgId, [...iRows.map((e) => reviewer(e.id)), ...sRows.map((e) => e.created_by)]);
    const inspections: InspectionInput[] = iRows.map((e) => {
      const by = reviewer(e.id);
      return {
        id: e.id, number: e.number, status: e.status, version: e.updated_at, data: e.data ?? {},
        waitingSince: waitingSince(e, events.get(e.id)), reviewedBy: by ? names.get(by) ?? null : null,
      };
    });
    const storeRoom: StoreRoomInput[] = sRows.map((e) => ({
      id: e.id, number: e.number, status: e.status, version: e.updated_at, data: e.data ?? {},
      waitingSince: waitingSince(e, events.get(e.id)), countedBy: e.created_by ? names.get(e.created_by) ?? null : null,
    }));
    return { inspections, storeRoom, storeRoomSpec: store?.spec ?? null };
  };

  const jobs = async (): Promise<{ failedJobs: OutboxFailure[]; syncFailures: SyncFailure[] }> => {
    if (!perms.jobs) return { failedJobs: [], syncFailures: [] };
    const admin = createAdminClient();
    const [outbox, states, run] = await Promise.all([
      admin.from('outbox_jobs').select('id, queue, attempts, last_error, locked_at, created_at')
        .eq('org_id', orgId).eq('status', 'failed').order('created_at', { ascending: true }).limit(100),
      db.from('xero_sync_state').select('entity, last_error, last_run_at').eq('org_id', orgId).not('last_error', 'is', null),
      admin.from('job_runs').select('id').eq('org_id', orgId).like('job', 'xero.sync.%').eq('ok', false)
        .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (outbox.error || states.error) throw new Error('jobs');
    const runId = (run.data?.id as number | undefined) ?? null;
    const rank = (e: string) => {
      const i = (SYNC_ENTITIES as readonly string[]).indexOf(e);
      return i < 0 ? SYNC_ENTITIES.length : i;
    };
    return {
      // drain() moves run_at forward even on the final failure, so locked_at (last attempt) is the failure time.
      failedJobs: (outbox.data ?? []).map((j) => ({
        id: j.id as string, queue: j.queue as string, attempts: j.attempts as number,
        lastError: (j.last_error as string | null) ?? null, failedAt: ((j.locked_at ?? j.created_at) as string),
      })),
      syncFailures: (states.data ?? [])
        .filter((s) => s.last_error)
        .sort((a, b) => rank(a.entity as string) - rank(b.entity as string))
        .map((s) => ({ entity: s.entity as string, error: s.last_error as string, at: ((s.last_run_at as string | null) ?? now.toISOString()), runId })),
    };
  };

  const leads = async (): Promise<LeadInput[]> => {
    if (!perms.leads) return [];
    const { data, error } = await db.from('leads').select('id, name, status, created_at, duplicate_of')
      .eq('org_id', orgId).eq('assigned_to', member.userId).eq('status', 'new').order('created_at', { ascending: true }).limit(100);
    if (error) throw new Error('leads');
    const rows = data ?? [];
    const dupIds = [...new Set(rows.map((l) => l.duplicate_of as string | null).filter((x): x is string => !!x))];
    const dupNames = new Map<string, string | null>();
    if (dupIds.length) {
      const { data: d } = await db.from('leads').select('id, name').eq('org_id', orgId).in('id', dupIds);
      for (const x of d ?? []) dupNames.set(x.id as string, (x.name as string | null) ?? null);
    }
    return rows.map((l) => ({
      id: l.id as string, name: (l.name as string | null) ?? null, status: l.status as string, createdAt: l.created_at as string,
      duplicateOf: (l.duplicate_of as string | null) ?? null, duplicateName: l.duplicate_of ? dupNames.get(l.duplicate_of as string) ?? null : null,
    }));
  };

  const [e, j, l] = await Promise.all([
    entries().catch(() => {
      failed.push('inspections', 'store-room');
      return { inspections: [], storeRoom: [], storeRoomSpec: null };
    }),
    jobs().catch(() => {
      failed.push('failed-jobs');
      return { failedJobs: [], syncFailures: [] };
    }),
    leads().catch(() => {
      failed.push('leads');
      return [] as LeadInput[];
    }),
  ]);

  const rows = buildTasks({ ...e, ...j, leads: l, perms, now });
  const shown = failed.filter((c, i) => failed.indexOf(c) === i && (filters as string[]).includes(c));
  return { rows, perms, filters, failed: shown };
}
