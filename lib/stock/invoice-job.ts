import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { enqueue, recordRun, type Job } from '@/lib/jobs/outbox';
import type { UnitFacts } from './invoice';
import { rpcOutcome } from './invoice';
import {
  applyRpcResult, cleanInvoiceIds, exceptionKey, invoicesFromInstant, countOutcome, emptyCounts, evaluateInvoice, itemCodesByInvoice, mergeInvoiceIds,
  MIRROR_INVOICE_COLUMNS, STOCK_INVOICES_QUEUE, type LineCodeRow, type MirrorInvoiceRow, type OutcomeCounts,
} from './invoice-review';
import { INVOICE_RULES_KEY, STOCK_START_KEY, stockSettingsFrom, type InvoiceRuleMode, type StockSettings } from './settings';

// Job 'stock.invoices' (docs/M6.md section 6): Xero mirror invoices -> unit reserved / sold, per app_settings
// 'stock.invoice_rules' (off | preview | live, default preview).
// - Queued with invoice ids after each mirror invoice upsert (lib/integrations/xero/sync.ts, next to the M3 paid
//   hook): ids are merged into the org's pending job, so a sync of many pages or webhooks runs one job.
// - Queued nightly as a sweep (scheduledSync full mode): every invoice changed since the stock start date, in
//   batches, continuing itself when out of time.
// Only invoices changed on/after the stock start date ('stock.deals_from') are checked; unset = none, so old unit
// sales never flood the exceptions queue. Preview evaluates and counts only (Invoice review shows each outcome
// live from the same rules); live calls stock_apply_invoice (service role), which re-checks and is idempotent:
// the same invoice state twice is a no-op, an exception is recorded once per invoice and reason.
// Logs to job_runs with counts only; never references or customer data.

const BATCH = 200;
/** Ids per `in.(...)` filter: 100 uuids keep the request URL well under proxy limits. */
const IN_CHUNK = 100;
const UNIT_PAGE = 1000;
const BUDGET_MS = 20_000;

export type StockInvoicesPayload =
  | { kind: 'ids'; invoice_ids: string[]; rev?: number }
  | { kind: 'sweep'; after?: string | null };

export interface StockInvoicesResult extends OutcomeCounts {
  mode: InvoiceRuleMode;
  skipped?: 'off' | 'no_start_date';
  evaluated: number;
  applied: number;
  recorded: number;
  failed: number;
  /** Sweep cursor (last invoice id) when the run stopped for time; null when complete. */
  next: string | null;
}

async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what} unreadable`);
  return data as T;
}

export async function loadStockSettings(db: SupabaseClient, orgId: string): Promise<StockSettings> {
  const rows = await must(db.from('app_settings').select('key, value').eq('org_id', orgId).in('key', [STOCK_START_KEY, INVOICE_RULES_KEY]), 'stock settings');
  return stockSettingsFrom(rows as Array<{ key: string; value: unknown }>);
}

export async function loadModelParts(db: SupabaseClient, orgId: string): Promise<string[]> {
  const rows = await must(db.from('stock_models').select('part_number').eq('org_id', orgId), 'stock models');
  return (rows as Array<{ part_number: string }>).map((m) => m.part_number);
}

/** Every unit of the org (VIN, status, invoice number), sold included: VINs and invoice numbers are unique. */
export async function loadUnitFacts(db: SupabaseClient, orgId: string): Promise<UnitFacts[]> {
  const out: UnitFacts[] = [];
  for (let from = 0; ; from += UNIT_PAGE) {
    const rows = await must(db.from('stock_units').select('id, vin_norm, status, invoice_number')
      .eq('org_id', orgId).order('id', { ascending: true }).range(from, from + UNIT_PAGE - 1), 'stock units');
    out.push(...(rows as UnitFacts[]));
    if ((rows as unknown[]).length < UNIT_PAGE) return out;
  }
}

export async function loadItemCodes(db: SupabaseClient, orgId: string, invoiceIds: readonly string[]): Promise<Map<string, (string | null)[]>> {
  const lines: LineCodeRow[] = [];
  for (let i = 0; i < invoiceIds.length; i += IN_CHUNK) {
    const rows = await must(db.from('xero_invoice_lines').select('invoice_id, item_code')
      .eq('org_id', orgId).in('invoice_id', invoiceIds.slice(i, i + IN_CHUNK)), 'invoice lines');
    lines.push(...(rows as LineCodeRow[]));
  }
  return itemCodesByInvoice(invoiceIds, lines);
}

/** Exceptions recorded for these invoices, keyed exceptionKey(xero invoice id, reason): open or resolved. */
export async function recordedExceptions(db: SupabaseClient, orgId: string, invoiceIds: readonly string[]): Promise<Map<string, 'open' | 'resolved'>> {
  const out = new Map<string, 'open' | 'resolved'>();
  for (let i = 0; i < invoiceIds.length; i += IN_CHUNK) {
    const rows = await must(db.from('stock_invoice_exceptions').select('xero_invoice_id, reason, resolved_at')
      .eq('org_id', orgId).in('xero_invoice_id', invoiceIds.slice(i, i + IN_CHUNK)), 'stock exceptions');
    for (const r of rows as Array<{ xero_invoice_id: string; reason: string; resolved_at: string | null }>) {
      out.set(exceptionKey(r.xero_invoice_id, r.reason), r.resolved_at ? 'resolved' : 'open');
    }
  }
  return out;
}

/**
 * Queues the stock rules for invoices the mirror just wrote. Merges into the org's pending ids job when there is
 * one (optimistic: the payload rev must not have moved); otherwise queues a new job. The handler re-reads its
 * payload after claiming, so ids merged before the claim are never lost.
 */
export async function enqueueStockInvoices(db: SupabaseClient, orgId: string, invoiceIds: readonly unknown[]): Promise<void> {
  const ids = cleanInvoiceIds(invoiceIds);
  if (!ids.length) return;
  const { data } = await db.from('outbox_jobs').select('id, payload')
    .eq('queue', STOCK_INVOICES_QUEUE).eq('status', 'pending').eq('org_id', orgId).eq('payload->>kind', 'ids')
    .order('created_at', { ascending: true }).limit(1);
  const pending = data?.[0] as { id: string; payload: { rev?: unknown } } | undefined;
  if (pending) {
    const merged = mergeInvoiceIds(pending.payload, ids);
    if (merged) {
      const rev = Number(pending.payload.rev ?? 0) || 0;
      const { data: upd } = await db.from('outbox_jobs')
        .update({ payload: { kind: 'ids', invoice_ids: merged, rev: rev + 1 } })
        .eq('id', pending.id).eq('status', 'pending').eq('payload->>rev', String(rev))
        .select('id');
      if (upd?.length) return;
    }
  }
  await enqueue(db, orgId, STOCK_INVOICES_QUEUE, { kind: 'ids', invoice_ids: ids, rev: 0 });
}

/** Queues the nightly sweep once (a pending sweep for the org is enough). */
export async function enqueueStockSweep(db: SupabaseClient, orgId: string): Promise<void> {
  const { data } = await db.from('outbox_jobs').select('id')
    .eq('queue', STOCK_INVOICES_QUEUE).eq('status', 'pending').eq('org_id', orgId).eq('payload->>kind', 'sweep').limit(1);
  if (data?.length) return;
  await enqueue(db, orgId, STOCK_INVOICES_QUEUE, { kind: 'sweep' });
}

/** Reads the job's payload as stored now (merges may have added ids after the drain listed it). */
async function currentPayload(db: SupabaseClient, job: Job): Promise<StockInvoicesPayload> {
  const { data } = await db.from('outbox_jobs').select('payload').eq('id', job.id).maybeSingle();
  const p = (data?.payload ?? job.payload) as { kind?: unknown; invoice_ids?: unknown; after?: unknown };
  if (p.kind === 'ids') return { kind: 'ids', invoice_ids: cleanInvoiceIds(Array.isArray(p.invoice_ids) ? p.invoice_ids : []) };
  return { kind: 'sweep', after: typeof p.after === 'string' ? p.after : null };
}

/**
 * Evaluates (and in live, applies) one batch of mirror invoices, in order. Returns how many it got through before
 * the deadline (all of them unless out of time).
 */
async function runBatch(
  db: SupabaseClient, orgId: string, mode: InvoiceRuleMode, rows: MirrorInvoiceRow[], units: UnitFacts[], modelParts: string[],
  res: StockInvoicesResult, deadline: number,
): Promise<number> {
  const ids = rows.map((r) => r.invoice_id);
  const codes = await loadItemCodes(db, orgId, ids);
  const recorded = mode === 'live' ? await recordedExceptions(db, orgId, ids) : new Map<string, 'open' | 'resolved'>();
  let done = 0;
  for (const row of rows) {
    if (Date.now() > deadline) return done;
    done += 1;
    const outcome = evaluateInvoice(row, codes.get(row.invoice_id) ?? [], units, modelParts);
    countOutcome(res, outcome);
    if (outcome.kind !== 'ignore') res.evaluated += 1;
    if (mode !== 'live') continue;
    const p = rpcOutcome(outcome);
    if (!p) continue;
    if (outcome.kind === 'exception' && recorded.has(exceptionKey(row.invoice_id, outcome.reason))) continue;
    const { data, error } = await db.rpc('stock_apply_invoice', {
      p_org: orgId, p_invoice_number: row.invoice_number, p_xero_invoice_id: row.invoice_id,
      p_reference: row.reference, p_outcome: p, p_mode: 'live',
    });
    if (error) {
      res.failed += 1;
      continue;
    }
    const r = data as { result?: string; recorded?: boolean } | null;
    if (r?.result === 'reserved' || r?.result === 'sold') res.applied += 1;
    if (r?.result === 'exception' && r.recorded) res.recorded += 1;
    applyRpcResult(units, data);
  }
  return done;
}

/** One run of the stock invoice rules for an org. */
export async function processStockInvoices(db: SupabaseClient, orgId: string, payload: StockInvoicesPayload, budgetMs = BUDGET_MS): Promise<StockInvoicesResult> {
  const deadline = Date.now() + budgetMs;
  const settings = await loadStockSettings(db, orgId);
  const res: StockInvoicesResult = { mode: settings.rules, evaluated: 0, applied: 0, recorded: 0, failed: 0, next: null, ...emptyCounts() };
  if (settings.rules === 'off') return { ...res, skipped: 'off' };
  if (!settings.start) return { ...res, skipped: 'no_start_date' };

  const { data: org } = await db.from('orgs').select('timezone').eq('id', orgId).maybeSingle();
  const since = invoicesFromInstant(settings.start, (org?.timezone as string | undefined) ?? 'Africa/Johannesburg');
  const [units, modelParts] = await Promise.all([loadUnitFacts(db, orgId), loadModelParts(db, orgId)]);

  if (payload.kind === 'ids') {
    for (let i = 0; i < payload.invoice_ids.length; i += IN_CHUNK) {
      const rows = await must(db.from('xero_invoices').select(MIRROR_INVOICE_COLUMNS)
        .eq('org_id', orgId).in('invoice_id', payload.invoice_ids.slice(i, i + IN_CHUNK)).gte('updated_utc', since)
        .order('invoice_id', { ascending: true }), 'invoices');
      // An ids job is small; it finishes even past the budget rather than dropping ids.
      await runBatch(db, orgId, settings.rules, rows as MirrorInvoiceRow[], units, modelParts, res, Number.POSITIVE_INFINITY);
    }
    return res;
  }

  let after = payload.after ?? null;
  for (;;) {
    let q = db.from('xero_invoices').select(MIRROR_INVOICE_COLUMNS)
      .eq('org_id', orgId).gte('updated_utc', since).order('invoice_id', { ascending: true }).limit(BATCH);
    if (after) q = q.gt('invoice_id', after);
    const rows = (await must(q, 'invoices')) as MirrorInvoiceRow[];
    if (!rows.length) return { ...res, next: null };
    const done = await runBatch(db, orgId, settings.rules, rows, units, modelParts, res, deadline);
    if (done > 0) after = rows[done - 1].invoice_id;
    // Out of time: continue after the last invoice handled (a fresh job, a fresh budget).
    if (done < rows.length) return { ...res, next: after ?? '' };
    if (rows.length < BATCH) return { ...res, next: null };
    if (Date.now() > deadline) return { ...res, next: after };
  }
}

/** Outbox handler for 'stock.invoices'. */
export async function runStockInvoicesJob(db: SupabaseClient, job: Job): Promise<void> {
  if (!job.org_id) throw new Error('job has no org');
  const orgId = job.org_id;
  const payload = await currentPayload(db, job);
  const r = await recordRun(db, orgId, STOCK_INVOICES_QUEUE, async () => {
    const res = await processStockInvoices(db, orgId, payload);
    return { ok: res.failed === 0, processed: res.evaluated, error: res.failed ? `${res.failed} invoices failed` : undefined, result: res };
  });
  if (payload.kind === 'sweep' && r.next !== null) await enqueue(db, orgId, STOCK_INVOICES_QUEUE, { kind: 'sweep', after: r.next || null });
}
