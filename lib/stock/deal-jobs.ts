import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ENTRY_COLUMNS, loadEntryById, openRow, type EntryRecord, type EntryRow } from '@/lib/forms/entries';
import { loadForm, type FormRecord } from '@/lib/forms/forms';
import { enqueue, recordRun, type Handler } from '@/lib/jobs/outbox';
import type { StockDealFields } from './deal';
import {
  DEAL_FORM_SLUG, DEALS_BACKFILL_QUEUE, DEALS_FROM_KEY, DEAL_SYNC_QUEUE, parseDealsFrom, stockJobsForSave,
  type DealEntry, type DealSyncCounts, type ExistingDeal,
} from './deal-sync';
import { backfillBudget, backfillDeals, syncDealEntry, type DealSyncStore, type UnreadableEntry } from './deal-sync-run';

// DEAL -> stock deal jobs (docs/M6.md section 6). The service role is used here only: jobs run from the outbox
// (/api/jobs/outbox with JOB_SECRET) and every query is scoped to the job's org. DEAL data is decrypted in memory;
// only dealFromEntry's output (date, branch, part numbers, line descriptions, quote number) is written, and job
// errors carry counts and codes, never entry values.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEAL_COLS = 'id, entry_id, year, number, location_id, model_part, quote_number, accessories, status, unit_id';

type DealRow = Omit<ExistingDeal, 'hasHistory'>;

const toEntry = (r: EntryRecord): DealEntry => ({ id: r.id, number: r.number, status: r.status, createdAt: r.createdAt, data: r.data });

/** The deal sync store for one org (service role client). */
export function supabaseDealStore(db: SupabaseClient, orgId: string): DealSyncStore {
  let form: Promise<FormRecord | null> | null = null;
  const dealForm = () => (form ??= loadForm(db, orgId, DEAL_FORM_SLUG));

  async function withHistory(rows: DealRow[]): Promise<ExistingDeal[]> {
    if (!rows.length) return [];
    const { data, error } = await db.from('stock_deal_dismissals').select('deal_id').eq('org_id', orgId).in('deal_id', rows.map((r) => r.id));
    if (error) throw new Error('stock deal history unreadable');
    const dismissed = new Set((data ?? []).map((d) => d.deal_id as string));
    return rows.map((r) => ({ ...r, accessories: r.accessories ?? [], hasHistory: dismissed.has(r.id) }));
  }

  return {
    async dealsFrom() {
      const { data, error } = await db.from('app_settings').select('value').eq('org_id', orgId).eq('key', DEALS_FROM_KEY).maybeSingle();
      if (error) throw new Error('stock settings unreadable');
      return parseDealsFrom(data?.value);
    },
    async reference() {
      const [models, locations] = await Promise.all([
        db.from('stock_models').select('part_number').eq('org_id', orgId),
        db.from('stock_locations').select('id').eq('org_id', orgId),
      ]);
      if (models.error || locations.error) throw new Error('stock reference data unreadable');
      return {
        modelParts: (models.data ?? []).map((m) => m.part_number as string),
        locationIds: (locations.data ?? []).map((l) => l.id as string),
      };
    },
    async entry(entryId) {
      const f = await dealForm();
      if (!f || !UUID.test(entryId)) return null;
      const e = await loadEntryById(db, f, entryId);
      return e && e.orgId === orgId ? toEntry(e) : null;
    },
    async entriesAfter(after, limit) {
      const f = await dealForm();
      if (!f) return [];
      const { data, error } = await db.from('entries').select(ENTRY_COLUMNS)
        .eq('org_id', orgId).eq('form_id', f.id).gt('number', after).order('number', { ascending: true }).limit(limit);
      if (error) throw new Error('DEAL entries unreadable');
      return ((data ?? []) as EntryRow[]).map((r): DealEntry | UnreadableEntry => {
        try {
          return toEntry(openRow(f, r));
        } catch {
          return { id: r.id, number: r.number, unreadable: true };
        }
      });
    },
    async dealsForEntries(entryIds) {
      if (!entryIds.length) return [];
      const { data, error } = await db.from('stock_deals').select(DEAL_COLS).eq('org_id', orgId).in('entry_id', [...entryIds]);
      if (error) throw new Error('stock deals unreadable');
      return withHistory((data ?? []) as DealRow[]);
    },
    async dealByYearNumber(year, number) {
      const { data, error } = await db.from('stock_deals').select(DEAL_COLS).eq('org_id', orgId).eq('year', year).eq('number', number).maybeSingle();
      if (error) throw new Error('stock deals unreadable');
      return data ? (await withHistory([data as DealRow]))[0] : null;
    },
    async insert(row: StockDealFields) {
      const { error } = await db.from('stock_deals').insert({ org_id: orgId, ...row, status: 'awaiting_dispatch' });
      if (!error) return 'ok';
      if (error.code === '23505') return 'conflict';
      throw new Error(`stock deal not saved (${error.code ?? 'error'})`);
    },
    async update(id, patch) {
      let q = db.from('stock_deals').update(patch).eq('org_id', orgId).eq('id', id);
      // Year and number change only while the deal awaits dispatch (a unit refers to them once dispatched).
      if ('year' in patch || 'number' in patch) q = q.eq('status', 'awaiting_dispatch');
      const { data, error } = await q.select('id');
      if (error) {
        if (error.code === '23505') return 'conflict';
        throw new Error(`stock deal not saved (${error.code ?? 'error'})`);
      }
      return data?.length ? 'ok' : 'conflict';
    },
    async remove(id) {
      // One statement re-checks the row and its history (dismissals, unit, stock audit rows): 0016.
      const { data, error } = await db.rpc('stock_remove_untouched_deal', { p_org: orgId, p_deal: id });
      if (error) throw new Error(`stock deal not removed (${error.code ?? 'error'})`);
      return data === true;
    },
  };
}

const problems = (c: DealSyncCounts) =>
  [c.conflicts ? `${c.conflicts} conflict${c.conflicts === 1 ? '' : 's'}` : '', c.failed ? `${c.failed} unreadable` : ''].filter(Boolean).join(', ') || undefined;

export const STOCK_DEAL_HANDLERS: Record<string, Handler> = {
  // One DEAL entry ({ entryId }) -> its stock deal. Idempotent; never downgrades a dispatched or dismissed deal.
  [DEAL_SYNC_QUEUE]: async (db, job) => {
    if (!job.org_id) throw new Error('job has no org');
    const entryId = (job.payload as { entryId?: unknown }).entryId;
    if (typeof entryId !== 'string' || !UUID.test(entryId)) throw new Error('job has no entry');
    await recordRun(db, job.org_id, DEAL_SYNC_QUEUE, async () => {
      const r = await syncDealEntry(supabaseDealStore(db, job.org_id!), entryId);
      return { ok: !problems(r), processed: r.inserted + r.updated + r.removed, error: problems(r), result: r };
    });
  },
  // Every DEAL entry ({ from: last entry number done }), batched and resumable: continues itself when out of time,
  // within the drain's deadline. A continuation stops when a fresh pass ("Rebuild deals") is queued: that pass
  // re-derives every deal from the first DEAL.
  [DEALS_BACKFILL_QUEUE]: async (db, job, ctx) => {
    if (!job.org_id) throw new Error('job has no org');
    const from = Number((job.payload as { from?: unknown }).from ?? 0) || 0;
    if (from > 0 && (await freshBackfillPending(db, job.org_id))) return;
    const r = await recordRun(db, job.org_id, DEALS_BACKFILL_QUEUE, async () => {
      const res = await backfillDeals(supabaseDealStore(db, job.org_id!), { from, budgetMs: backfillBudget(ctx?.deadline, Date.now()) });
      return { ok: !problems(res), processed: res.processed, error: problems(res), result: res };
    });
    if (!r.complete) await enqueue(db, job.org_id, DEALS_BACKFILL_QUEUE, { from: r.next });
  },
};

/** Called by runAction after a save (and by systemUpdateEntry): a DEAL save queues its stock deal sync. */
export async function enqueueStockJobsForSave(db: SupabaseClient, orgId: string, formSlug: string, actionName: string, entryId: string) {
  for (const queue of stockJobsForSave(formSlug, actionName)) await enqueue(db, orgId, queue, { entryId });
}

/** A pending backfill that starts from the first DEAL ({ from: 0 }, or no from) for the org. */
async function freshBackfillPending(db: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await db.from('outbox_jobs').select('id')
    .eq('org_id', orgId).eq('queue', DEALS_BACKFILL_QUEUE).eq('status', 'pending')
    .or('payload->>from.is.null,payload->>from.eq.0').limit(1);
  if (error) throw new Error('outbox unreadable');
  return !!data?.length;
}

/**
 * "Rebuild deals" (Setup, stock.manage) and a changed start date: re-derive every DEAL's stock deal from the first
 * DEAL. Always queues a fresh pass unless one is already pending; a pending continuation of an older pass does not
 * count (it stops itself once this pass is queued).
 */
export async function enqueueDealsBackfill(db: SupabaseClient, orgId: string) {
  if (await freshBackfillPending(db, orgId)) return;
  await enqueue(db, orgId, DEALS_BACKFILL_QUEUE, { from: 0 });
}
