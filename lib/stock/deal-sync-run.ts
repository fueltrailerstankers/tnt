// The deal sync, written against a small store so it is tested without a database (tests/unit/stock-deal-sync.test.ts).
// lib/stock/deal-jobs.ts provides the Supabase store (service role, org-bound) and the outbox handlers.
// Idempotent: running it twice for the same DEAL state writes nothing the second time.

import type { StockDealFields } from './deal';
import {
  emptyCounts, planDealSync, stockDealFor, type DealEntry, type DealReference, type DealSyncCounts, type ExistingDeal,
} from './deal-sync';

export interface UnreadableEntry {
  id: string;
  number: number;
  unreadable: true;
}

/** Everything the sync reads and writes, bound to one org. */
export interface DealSyncStore {
  /** app_settings 'stock.deals_from', parsed; null = unset (no deals are imported). */
  dealsFrom(): Promise<string | null>;
  reference(): Promise<DealReference>;
  /** One DEAL entry of the org, decrypted; null when there is none with this id. */
  entry(entryId: string): Promise<DealEntry | null>;
  /** DEAL entries with number > after, by number ascending. Entries that cannot be decrypted come back as unreadable. */
  entriesAfter(after: number, limit: number): Promise<Array<DealEntry | UnreadableEntry>>;
  dealsForEntries(entryIds: readonly string[]): Promise<ExistingDeal[]>;
  dealByYearNumber(year: number, number: number): Promise<ExistingDeal | null>;
  /** 'conflict' on a unique violation (entry or year + number already taken). */
  insert(row: StockDealFields): Promise<'ok' | 'conflict'>;
  /** 'conflict' on a unique violation, or when a year/number change finds the deal no longer awaiting dispatch. */
  update(id: string, patch: Partial<StockDealFields>): Promise<'ok' | 'conflict'>;
  /** Removes the deal only while it still awaits dispatch without a unit. */
  remove(id: string): Promise<void>;
}

const isReadable = (e: DealEntry | UnreadableEntry): e is DealEntry => !('unreadable' in e);

/** Applies one DEAL entry's plan, counting the outcome. */
export async function applyDealEntry(
  store: DealSyncStore, entry: DealEntry, existing: ExistingDeal | null, dealsFrom: string | null, ref: DealReference, counts: DealSyncCounts,
): Promise<void> {
  const next = stockDealFor(entry, dealsFrom, ref);
  let plan = planDealSync(existing, next);
  if (plan.kind === 'insert') {
    if ((await store.insert(plan.row)) === 'ok') {
      counts.inserted += 1;
      return;
    }
    // Taken meanwhile: a concurrent sync of the same entry, or a deal with the same year and number. A row with no
    // entry (its DEAL entry was deleted and re-created) is adopted; another DEAL's deal is left alone.
    const mine = (await store.dealsForEntries([entry.id]))[0] ?? null;
    const holder = mine ?? (await store.dealByYearNumber(plan.row.year, plan.row.number));
    if (!holder || (holder.entry_id !== null && holder.entry_id !== entry.id)) {
      counts.conflicts += 1;
      return;
    }
    plan = planDealSync(holder, next);
  }
  switch (plan.kind) {
    case 'update':
      if ((await store.update(plan.id, plan.patch)) === 'ok') counts.updated += 1;
      else counts.conflicts += 1;
      return;
    case 'remove':
      await store.remove(plan.id);
      counts.removed += 1;
      return;
    case 'noop':
      if (plan.reason === 'out_of_scope') counts.skipped += 1;
      else counts.unchanged += 1;
      return;
    default:
      counts.conflicts += 1;
  }
}

export interface DealSyncResult extends DealSyncCounts {
  /** No start date set: nothing was read or written. */
  disabled: boolean;
}

/** stock.deal-sync: one DEAL entry (after Submit / Update / Action, or a system update such as the quote import). */
export async function syncDealEntry(store: DealSyncStore, entryId: string): Promise<DealSyncResult> {
  const counts = emptyCounts();
  const dealsFrom = await store.dealsFrom();
  if (!dealsFrom) return { ...counts, disabled: true };
  const entry = await store.entry(entryId);
  if (!entry) return { ...counts, skipped: 1, disabled: false };
  const [ref, existing] = await Promise.all([store.reference(), store.dealsForEntries([entry.id])]);
  await applyDealEntry(store, entry, existing[0] ?? null, dealsFrom, ref, counts);
  return { ...counts, disabled: false };
}

export interface BackfillResult extends DealSyncResult {
  /** Entries looked at in this run. */
  processed: number;
  /** All DEAL entries done. */
  complete: boolean;
  /** Last DEAL entry number done: the next run continues after it. */
  next: number;
}

export const BACKFILL_BATCH = 100;

/**
 * stock.deals-backfill: every DEAL entry in number order, in batches, until done or out of time. Resumable from
 * `from` (the last entry number done). DATE CREATED is inside the encrypted data, so every DEAL is read and
 * stockDealFor decides; entries before the start date are skipped (or their untouched deal removed).
 */
export async function backfillDeals(
  store: DealSyncStore, opts: { from?: number; budgetMs: number; batch?: number; now?: () => number },
): Promise<BackfillResult> {
  const now = opts.now ?? Date.now;
  const deadline = now() + opts.budgetMs;
  const batch = opts.batch ?? BACKFILL_BATCH;
  const counts = emptyCounts();
  let after = Math.max(0, Math.trunc(opts.from ?? 0));
  let processed = 0;
  const dealsFrom = await store.dealsFrom();
  if (!dealsFrom) return { ...counts, disabled: true, processed, complete: true, next: after };
  const ref = await store.reference();
  for (;;) {
    const page = await store.entriesAfter(after, batch);
    const readable = page.filter(isReadable);
    const existing = readable.length ? await store.dealsForEntries(readable.map((e) => e.id)) : [];
    const byEntry = new Map(existing.map((d) => [d.entry_id, d]));
    for (const e of page) {
      if (isReadable(e)) await applyDealEntry(store, e, byEntry.get(e.id) ?? null, dealsFrom, ref, counts);
      else counts.failed += 1;
      processed += 1;
      after = e.number;
    }
    if (page.length < batch) return { ...counts, disabled: false, processed, complete: true, next: after };
    if (now() >= deadline) return { ...counts, disabled: false, processed, complete: false, next: after };
  }
}
