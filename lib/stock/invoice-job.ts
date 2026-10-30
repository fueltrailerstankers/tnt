import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { enqueue, recordRun, type Job } from '@/lib/jobs/outbox';
import type { InvoiceOutcome, UnitFacts } from './invoice';
import { rpcOutcome } from './invoice';
import {
  applyRpcResult, cleanInvoiceIds, countOutcome, creditNoteOutcome, emptyCounts, evaluateInvoice, exceptionKey, invoicesFromInstant,
  itemCodesByInvoice, mayMergeInto, mergeIdsPayload, MIRROR_CREDIT_NOTE_COLUMNS, MIRROR_INVOICE_COLUMNS, mustWait, otherInvoicesNamingVin,
  recordedState, STOCK_INVOICES_QUEUE, type LineCodeRow, type MirrorCreditNoteRow, type MirrorInvoiceRow, type OutcomeCounts,
  type RecordedException,
} from './invoice-review';
import { INVOICE_RULES_KEY, INVOICES_FROM_KEY, STOCK_START_KEY, stockSettingsFrom, type InvoiceRuleMode, type StockSettings } from './settings';

// Job 'stock.invoices' (docs/M6.md sections 6 and 12): Xero mirror invoices -> unit reserved / sold, per app_settings
// 'stock.invoice_rules' (off | preview | live, default preview).
// - Queued with invoice and credit note ids after each mirror upsert (lib/integrations/xero/sync.ts, next to the M3
//   paid hook): ids are merged into the org's untried pending job, so a sync of many pages runs one job.
// - Queued nightly as a sweep (scheduledSync full mode): every invoice, then every credit note, changed since the
//   invoice start date, in batches, continuing itself when out of time.
// - One job at a time per org: a job claimed while another for the org runs re-queues itself 30 s later.
// Only documents changed on/after the invoice start date ('stock.invoices_from', else 'stock.deals_from') are
// examined; unset = none. Preview evaluates and counts only; live calls stock_apply_invoice (service role) after
// re-reading the mirror row, so a state that changed during the run is never applied. The RPC re-checks under its
// own lock; an exception is recorded once per invoice, reason and Xero state. Logs counts only to job_runs.

const BATCH = 200;
/** Ids per `in.(...)` filter: 100 uuids keep the request URL well under proxy limits. */
const IN_CHUNK = 100;
const UNIT_PAGE = 1000;
const BUDGET_MS = 20_000;
const WAIT_MS = 30_000;

export type StockInvoicesPayload =
  | { kind: 'ids'; invoice_ids: string[]; credit_note_ids: string[] }
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
  const rows = await must(db.from('app_settings').select('key, value').eq('org_id', orgId).in('key', [STOCK_START_KEY, INVOICES_FROM_KEY, INVOICE_RULES_KEY]), 'stock settings');
  return stockSettingsFrom(rows as Array<{ key: string; value: unknown }>);
}

export async function loadModelParts(db: SupabaseClient, orgId: string): Promise<string[]> {
  const rows = await must(db.from('stock_models').select('part_number').eq('org_id', orgId), 'stock models');
  return (rows as Array<{ part_number: string }>).map((m) => m.part_number);
}

/** A unit as the rules see it, plus the Xero invoice it is linked to (null after a manual apply). */
export type JobUnit = UnitFacts & { xero_invoice_id: string | null };

/** Every unit of the org (VIN, status, invoice number), sold included: VINs and invoice numbers are unique. */
export async function loadUnitFacts(db: SupabaseClient, orgId: string): Promise<JobUnit[]> {
  const out: JobUnit[] = [];
  for (let from = 0; ; from += UNIT_PAGE) {
    const rows = await must(db.from('stock_units').select('id, vin_norm, status, invoice_number, xero_invoice_id')
      .eq('org_id', orgId).order('id', { ascending: true }).range(from, from + UNIT_PAGE - 1), 'stock units');
    out.push(...(rows as JobUnit[]));
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

/** Exceptions recorded for these Xero documents, keyed exceptionKey(xero id, reason), with state and Xero time. */
export async function recordedExceptions(db: SupabaseClient, orgId: string, xeroIds: readonly string[]): Promise<Map<string, RecordedException[]>> {
  const out = new Map<string, RecordedException[]>();
  for (let i = 0; i < xeroIds.length; i += IN_CHUNK) {
    const rows = await must(db.from('stock_invoice_exceptions').select('xero_invoice_id, reason, resolved_at, source_updated_utc')
      .eq('org_id', orgId).in('xero_invoice_id', xeroIds.slice(i, i + IN_CHUNK)), 'stock exceptions');
    for (const r of rows as Array<{ xero_invoice_id: string; reason: string; resolved_at: string | null; source_updated_utc: string | null }>) {
      const k = exceptionKey(r.xero_invoice_id, r.reason);
      out.set(k, [...(out.get(k) ?? []), { resolved: !!r.resolved_at, source_updated_utc: r.source_updated_utc }]);
    }
  }
  return out;
}

/**
 * Other live invoices naming the VIN, from the mirror (reference contains it; the pure check confirms the match).
 * Used for 'apply' outcomes only: one invoice covers one unit.
 */
export async function invoicesNamingVin(db: SupabaseClient, orgId: string, self: MirrorInvoiceRow, vin: string): Promise<MirrorInvoiceRow[]> {
  const rows = await must(db.from('xero_invoices').select(MIRROR_INVOICE_COLUMNS)
    .eq('org_id', orgId).ilike('reference', `*${vin.replace(/[*%_,()\\]/g, '')}*`).limit(50), 'invoices');
  return otherInvoicesNamingVin(self, vin, rows as MirrorInvoiceRow[]);
}

/** An 'apply' outcome becomes 'vin_on_several_invoices' when another live invoice names the same VIN. */
export async function withVinConflict(db: SupabaseClient, orgId: string, row: MirrorInvoiceRow, o: InvoiceOutcome): Promise<InvoiceOutcome> {
  if (o.kind !== 'apply') return o;
  const others = await invoicesNamingVin(db, orgId, row, o.vin);
  return others.length ? { kind: 'exception', reason: 'vin_on_several_invoices', unitId: o.unitId, vin: o.vin } : o;
}

interface PendingJob { id: string; payload: { rev?: unknown }; status: string; attempts: number }

/**
 * Queues the stock rules for documents the mirror just wrote. Merges into the org's pending ids job when nothing
 * has tried it yet (attempts 0; optimistic on payload.rev); otherwise queues a new job. The handler re-reads its
 * payload after claiming, so ids merged before the claim are never lost.
 */
async function enqueueIds(db: SupabaseClient, orgId: string, add: { invoice_ids?: string[]; credit_note_ids?: string[] }): Promise<void> {
  const n = (add.invoice_ids?.length ?? 0) + (add.credit_note_ids?.length ?? 0);
  if (!n) return;
  const { data } = await db.from('outbox_jobs').select('id, payload, status, attempts')
    .eq('queue', STOCK_INVOICES_QUEUE).eq('status', 'pending').eq('attempts', 0).eq('org_id', orgId).eq('payload->>kind', 'ids')
    .order('created_at', { ascending: true }).limit(1);
  const pending = data?.[0] as PendingJob | undefined;
  if (pending && mayMergeInto(pending)) {
    const merged = mergeIdsPayload(pending.payload, add);
    if (merged) {
      const rev = Number(pending.payload.rev ?? 0) || 0;
      const { data: upd } = await db.from('outbox_jobs')
        .update({ payload: { kind: 'ids', ...merged, rev: rev + 1 } })
        .eq('id', pending.id).eq('status', 'pending').eq('attempts', 0).eq('payload->>rev', String(rev))
        .select('id');
      if (upd?.length) return;
    }
  }
  await enqueue(db, orgId, STOCK_INVOICES_QUEUE, { kind: 'ids', invoice_ids: add.invoice_ids ?? [], credit_note_ids: add.credit_note_ids ?? [], rev: 0 });
}

export async function enqueueStockInvoices(db: SupabaseClient, orgId: string, invoiceIds: readonly unknown[]): Promise<void> {
  await enqueueIds(db, orgId, { invoice_ids: cleanInvoiceIds(invoiceIds) });
}

export async function enqueueStockCreditNotes(db: SupabaseClient, orgId: string, creditNoteIds: readonly unknown[]): Promise<void> {
  await enqueueIds(db, orgId, { credit_note_ids: cleanInvoiceIds(creditNoteIds) });
}

/** Queues the nightly sweep once (a pending sweep for the org is enough). */
export async function enqueueStockSweep(db: SupabaseClient, orgId: string): Promise<void> {
  const { data } = await db.from('outbox_jobs').select('id')
    .eq('queue', STOCK_INVOICES_QUEUE).eq('status', 'pending').eq('org_id', orgId).eq('payload->>kind', 'sweep').limit(1);
  if (data?.length) return;
  await enqueue(db, orgId, STOCK_INVOICES_QUEUE, { kind: 'sweep' });
}

/** The job's row as stored now (merges may have added ids after the drain listed it). Throws when unreadable. */
async function currentRow(db: SupabaseClient, job: Job): Promise<{ payload: StockInvoicesPayload; locked_at: string | null }> {
  const { data, error } = await db.from('outbox_jobs').select('payload, locked_at').eq('id', job.id).maybeSingle();
  if (error || !data) throw new Error('stock.invoices job payload unreadable');
  const p = (data.payload ?? {}) as { kind?: unknown; invoice_ids?: unknown; credit_note_ids?: unknown; after?: unknown };
  const ids = (v: unknown) => cleanInvoiceIds(Array.isArray(v) ? v : []);
  const payload: StockInvoicesPayload = p.kind === 'ids'
    ? { kind: 'ids', invoice_ids: ids(p.invoice_ids), credit_note_ids: ids(p.credit_note_ids) }
    : { kind: 'sweep', after: typeof p.after === 'string' ? p.after : null };
  return { payload, locked_at: (data.locked_at as string | null) ?? null };
}

interface RunCtx {
  db: SupabaseClient;
  orgId: string;
  mode: InvoiceRuleMode;
  since: string;
  units: JobUnit[];
  modelParts: string[];
  res: StockInvoicesResult;
}

async function callApply(ctx: RunCtx, args: { number: string | null; xeroId: string; reference: string | null; outcome: string; updated: string | null }) {
  const { data, error } = await ctx.db.rpc('stock_apply_invoice', {
    p_org: ctx.orgId, p_invoice_number: args.number, p_xero_invoice_id: args.xeroId, p_reference: args.reference,
    p_outcome: args.outcome, p_mode: 'live', p_source_updated: args.updated,
  });
  if (error) {
    ctx.res.failed += 1;
    return null;
  }
  const r = data as { result?: string; recorded?: boolean; unit_id?: unknown } | null;
  if (r?.result === 'reserved' || r?.result === 'sold') ctx.res.applied += 1;
  if (r?.result === 'exception' && r.recorded) ctx.res.recorded += 1;
  applyRpcResult(ctx.units, data);
  return r;
}

/** Re-reads one invoice right before acting on it; null when gone or no longer in range. */
async function freshInvoice(ctx: RunCtx, id: string): Promise<MirrorInvoiceRow | null> {
  const { data, error } = await ctx.db.from('xero_invoices').select(MIRROR_INVOICE_COLUMNS).eq('org_id', ctx.orgId).eq('invoice_id', id).maybeSingle();
  if (error) throw new Error('invoice unreadable');
  const row = data as MirrorInvoiceRow | null;
  return row && row.updated_utc && row.updated_utc >= ctx.since ? row : null;
}

/**
 * Evaluates (and in live, applies) one batch of mirror invoices, in order. Returns how many it got through before
 * the deadline (all of them unless out of time).
 */
async function runBatch(ctx: RunCtx, rows: MirrorInvoiceRow[], deadline: number): Promise<number> {
  const { units, modelParts, res } = ctx;
  const ids = rows.map((r) => r.invoice_id);
  const codes = await loadItemCodes(ctx.db, ctx.orgId, ids);
  const recorded = ctx.mode === 'live' ? await recordedExceptions(ctx.db, ctx.orgId, ids) : new Map<string, RecordedException[]>();
  let done = 0;
  for (const listed of rows) {
    if (Date.now() > deadline) return done;
    done += 1;
    let row = listed;
    let outcome = evaluateInvoice(row, codes.get(row.invoice_id) ?? [], units, modelParts);
    countOutcome(res, outcome);
    if (outcome.kind !== 'ignore') res.evaluated += 1;
    if (ctx.mode !== 'live' || outcome.kind === 'ignore') continue;
    // Already applied (e.g. manually before the invoice reached Xero) and linked: nothing to do.
    const linkOnly = outcome.kind === 'noop' && units.find((u) => u.id === (outcome as { unitId: string }).unitId)?.xero_invoice_id === null;
    if (outcome.kind === 'noop' && !linkOnly) continue;
    // Re-read the invoice right before acting: a state that changed since the batch was listed is never applied.
    const fresh = await freshInvoice(ctx, row.invoice_id);
    if (!fresh) continue;
    if (fresh.updated_utc !== row.updated_utc || fresh.status !== row.status || String(fresh.amount_due) !== String(row.amount_due)) {
      row = fresh;
      outcome = evaluateInvoice(row, codes.get(row.invoice_id) ?? [], units, modelParts);
    }
    outcome = await withVinConflict(ctx.db, ctx.orgId, row, outcome);
    if (outcome.kind === 'exception' && recordedState(recorded.get(exceptionKey(row.invoice_id, outcome.reason)), row.updated_utc)) continue;
    const p = outcome.kind === 'noop' ? (linkOnly ? outcome.status : null) : rpcOutcome(outcome);
    if (!p) continue;
    const r = await callApply(ctx, { number: row.invoice_number, xeroId: row.invoice_id, reference: row.reference, outcome: p, updated: row.updated_utc });
    const linked = units.find((u) => u.id === r?.unit_id);
    if (linked && r?.result !== 'exception') linked.xero_invoice_id = row.invoice_id;
  }
  return done;
}

/** Credit notes: sales ones naming a unit (directly or through an allocated invoice) become 'credit_note' exceptions. */
async function runCreditNotes(ctx: RunCtx, notes: MirrorCreditNoteRow[]): Promise<void> {
  if (!notes.length) return;
  const invIds = [...new Set(notes.flatMap((n) => n.invoice_ids ?? []))];
  const allocated = new Map<string, MirrorInvoiceRow>();
  for (let i = 0; i < invIds.length; i += IN_CHUNK) {
    const rows = await must(ctx.db.from('xero_invoices').select(MIRROR_INVOICE_COLUMNS).eq('org_id', ctx.orgId).in('invoice_id', invIds.slice(i, i + IN_CHUNK)), 'invoices');
    for (const r of rows as MirrorInvoiceRow[]) allocated.set(r.invoice_id, r);
  }
  const recorded = ctx.mode === 'live' ? await recordedExceptions(ctx.db, ctx.orgId, notes.map((n) => n.credit_note_id)) : new Map<string, RecordedException[]>();
  for (const cn of notes) {
    const o = creditNoteOutcome(cn, (cn.invoice_ids ?? []).map((id) => allocated.get(id)).filter((x): x is MirrorInvoiceRow => !!x), ctx.units);
    if (o.kind === 'ignore') continue;
    ctx.res.evaluated += 1;
    ctx.res.exceptions += 1;
    if (ctx.mode !== 'live') continue;
    if (recordedState(recorded.get(exceptionKey(cn.credit_note_id, o.reason)), cn.updated_utc)) continue;
    // The VIN as the reference lets the RPC attach the unit; the credit note number stands in for the invoice number.
    await callApply(ctx, { number: cn.credit_note_number, xeroId: cn.credit_note_id, reference: o.vin, outcome: 'exception:credit_note', updated: cn.updated_utc });
  }
}

/** One run of the stock invoice rules for an org. */
export async function processStockInvoices(db: SupabaseClient, orgId: string, payload: StockInvoicesPayload, budgetMs = BUDGET_MS): Promise<StockInvoicesResult> {
  const deadline = Date.now() + budgetMs;
  const settings = await loadStockSettings(db, orgId);
  const res: StockInvoicesResult = { mode: settings.rules, evaluated: 0, applied: 0, recorded: 0, failed: 0, next: null, ...emptyCounts() };
  if (settings.rules === 'off') return { ...res, skipped: 'off' };
  if (!settings.invoicesFrom) return { ...res, skipped: 'no_start_date' };

  const { data: org } = await db.from('orgs').select('timezone').eq('id', orgId).maybeSingle();
  const since = invoicesFromInstant(settings.invoicesFrom, (org?.timezone as string | undefined) ?? 'Africa/Johannesburg');
  const [units, modelParts] = await Promise.all([loadUnitFacts(db, orgId), loadModelParts(db, orgId)]);
  const ctx: RunCtx = { db, orgId, mode: settings.rules, since, units, modelParts, res };

  const creditNoteBase = () => db.from('xero_credit_notes').select(MIRROR_CREDIT_NOTE_COLUMNS).eq('org_id', orgId).gte('updated_utc', since);

  if (payload.kind === 'ids') {
    for (let i = 0; i < payload.invoice_ids.length; i += IN_CHUNK) {
      const rows = await must(db.from('xero_invoices').select(MIRROR_INVOICE_COLUMNS)
        .eq('org_id', orgId).in('invoice_id', payload.invoice_ids.slice(i, i + IN_CHUNK)).gte('updated_utc', since)
        .order('invoice_id', { ascending: true }), 'invoices');
      // An ids job is small; it finishes even past the budget rather than dropping ids.
      await runBatch(ctx, rows as MirrorInvoiceRow[], Number.POSITIVE_INFINITY);
    }
    for (let i = 0; i < payload.credit_note_ids.length; i += IN_CHUNK) {
      const rows = await must(creditNoteBase().in('credit_note_id', payload.credit_note_ids.slice(i, i + IN_CHUNK)), 'credit notes');
      await runCreditNotes(ctx, rows as MirrorCreditNoteRow[]);
    }
    return res;
  }

  let after = payload.after ?? null;
  for (;;) {
    let q = db.from('xero_invoices').select(MIRROR_INVOICE_COLUMNS)
      .eq('org_id', orgId).gte('updated_utc', since).order('invoice_id', { ascending: true }).limit(BATCH);
    if (after) q = q.gt('invoice_id', after);
    const rows = (await must(q, 'invoices')) as MirrorInvoiceRow[];
    if (!rows.length) break;
    const done = await runBatch(ctx, rows, deadline);
    if (done > 0) after = rows[done - 1].invoice_id;
    // Out of time: continue after the last invoice handled (a fresh job, a fresh budget).
    if (done < rows.length) return { ...res, next: after ?? '' };
    if (rows.length < BATCH) break;
    if (Date.now() > deadline) return { ...res, next: after };
  }
  // Invoices done: the credit notes changed since the start date (few; the RPC dedupes).
  for (let from = 0; ; from += BATCH) {
    const rows = await must(creditNoteBase().order('credit_note_id', { ascending: true }).range(from, from + BATCH - 1), 'credit notes');
    await runCreditNotes(ctx, rows as MirrorCreditNoteRow[]);
    if ((rows as unknown[]).length < BATCH) break;
  }
  return { ...res, next: null };
}

/** Outbox handler for 'stock.invoices'. */
export async function runStockInvoicesJob(db: SupabaseClient, job: Job): Promise<void> {
  if (!job.org_id) throw new Error('job has no org');
  const orgId = job.org_id;
  const { payload, locked_at } = await currentRow(db, job);
  // One at a time per org: a run that started earlier finishes first; this one comes back in 30 s.
  const { data: running, error } = await db.from('outbox_jobs').select('id, locked_at')
    .eq('queue', STOCK_INVOICES_QUEUE).eq('org_id', orgId).eq('status', 'running');
  if (error) throw new Error('stock.invoices jobs unreadable');
  if (mustWait({ id: job.id, locked_at }, (running ?? []) as Array<{ id: string; locked_at: string | null }>)) {
    const { error: e } = await db.from('outbox_jobs').insert({
      org_id: orgId, queue: STOCK_INVOICES_QUEUE, run_at: new Date(Date.now() + WAIT_MS).toISOString(),
      payload: payload.kind === 'ids' ? { ...payload, rev: 0 } : payload,
    });
    if (e) throw new Error('Could not defer job');
    return;
  }
  const r = await recordRun(db, orgId, STOCK_INVOICES_QUEUE, async () => {
    const res = await processStockInvoices(db, orgId, payload);
    return { ok: res.failed === 0, processed: res.evaluated, error: res.failed ? `${res.failed} invoices failed` : undefined, result: res };
  });
  if (payload.kind === 'sweep' && r.next !== null) await enqueue(db, orgId, STOCK_INVOICES_QUEUE, { kind: 'sweep', after: r.next || null });
}
