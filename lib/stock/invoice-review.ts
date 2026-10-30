// Invoice review and the stock.invoices job: mirror rows -> invoiceOutcome, labels, payload merging. Pure.
// The job (lib/stock/invoice-job.ts) and the Invoice review page evaluate invoices with the same function, so the
// page shows exactly what the job does (preview) or did (applied). stock_apply_invoice re-checks in the database.

import { zonedDayStart } from '@/lib/admin/grid';
import type { Tone } from '@/lib/ui/status';
import { EXCEPTION_REASON_LABEL, unitStatusLabel } from './errors';
import { invoiceOutcome, matchUnit, normalizeInvoiceNumber, type InvoiceOutcome, type UnitFacts } from './invoice';
import { extractVin, matchedVin } from './vin';
import type { UnitStatus } from './kpi';
import type { InvoiceRuleMode } from './settings';

export const STOCK_INVOICES_QUEUE = 'stock.invoices';
/** Invoice ids merged into one pending job at most; beyond that a new job is queued. */
export const MAX_IDS_PER_JOB = 500;

/** The xero_invoices columns the rules read. */
export const MIRROR_INVOICE_COLUMNS = 'invoice_id, invoice_number, invoice_type, status, amount_due, credit_note_applied, reference, updated_utc';
/** The xero_credit_notes columns the rules read. */
export const MIRROR_CREDIT_NOTE_COLUMNS = 'credit_note_id, credit_note_number, credit_note_type, status, reference, invoice_ids, updated_utc';

export interface MirrorInvoiceRow {
  invoice_id: string;
  invoice_number: string | null;
  invoice_type: string | null;
  status: string | null;
  amount_due: number | string | null;
  /** Credit notes allocated (0019: CreditNotes[].AppliedAmount), not Xero's AmountCredited (which counts prepayments). */
  credit_note_applied: number | string | null;
  reference: string | null;
  updated_utc: string | null;
}

export interface MirrorCreditNoteRow {
  credit_note_id: string;
  credit_note_number: string | null;
  credit_note_type: string | null;
  status: string | null;
  reference: string | null;
  invoice_ids: string[] | null;
  updated_utc: string | null;
}

export interface LineCodeRow {
  invoice_id: string;
  item_code: string | null;
}

/**
 * The first instant (UTC ISO) the invoice rules look at: the start of the stock start date in the org timezone.
 * Invoices last changed in Xero before it are history and never checked (no exceptions for old unit sales).
 */
export function invoicesFromInstant(start: string, timeZone: string): string {
  return zonedDayStart(start, timeZone);
}

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Item codes per invoice id (every invoice gets a list, [] when it has no lines). */
export function itemCodesByInvoice(invoiceIds: readonly string[], lines: readonly LineCodeRow[]): Map<string, (string | null)[]> {
  const m = new Map<string, (string | null)[]>(invoiceIds.map((id) => [id, []]));
  for (const l of lines) m.get(l.invoice_id)?.push(l.item_code);
  return m;
}

/** What one mirror invoice does to stock, given the org's units and model part numbers. */
export function evaluateInvoice(row: MirrorInvoiceRow, itemCodes: readonly (string | null)[], units: readonly UnitFacts[], modelParts: readonly string[]): InvoiceOutcome {
  const facts = {
    invoice_id: row.invoice_id,
    invoice_number: row.invoice_number,
    invoice_type: row.invoice_type,
    status: row.status,
    amount_due: num(row.amount_due),
    amount_credited: num(row.credit_note_applied),
    reference: row.reference,
    item_codes: itemCodes,
  };
  return invoiceOutcome(facts, matchUnit(facts, units), modelParts);
}

export interface OutcomeCounts {
  ignored: number;
  noop: number;
  reserve: number;
  sell: number;
  exceptions: number;
}

export const emptyCounts = (): OutcomeCounts => ({ ignored: 0, noop: 0, reserve: 0, sell: 0, exceptions: 0 });

export function countOutcome(c: OutcomeCounts, o: InvoiceOutcome): void {
  if (o.kind === 'ignore') c.ignored += 1;
  else if (o.kind === 'noop') c.noop += 1;
  else if (o.kind === 'exception') c.exceptions += 1;
  else if (o.status === 'sold') c.sell += 1;
  else c.reserve += 1;
}

/** After a live stock_apply_invoice changed a unit, the in-memory unit follows, so later invoices see it. */
export function applyRpcResult(units: UnitFacts[], result: unknown): void {
  if (!result || typeof result !== 'object') return;
  const r = result as { result?: unknown; unit_id?: unknown; invoice_number?: unknown };
  if ((r.result !== 'reserved' && r.result !== 'sold') || typeof r.unit_id !== 'string') return;
  const u = units.find((x) => x.id === r.unit_id);
  if (!u) return;
  u.status = r.result as UnitStatus;
  u.invoice_number = typeof r.invoice_number === 'string' ? r.invoice_number : u.invoice_number;
}

export interface OutcomeView {
  label: string;
  tone: Tone;
}

/** Whether an exception for this invoice and reason is in the queue (open), was resolved, or was never recorded. */
export type RecordedState = 'open' | 'resolved' | null;

export const exceptionKey = (xeroInvoiceId: string, reason: string) => `${xeroInvoiceId}|${reason}`;

/**
 * The outcome chip on Invoice review.
 * - noop: the unit already reflects the invoice ("Applied: Reserved" / "Applied: Sold"), in any mode.
 * - apply: what the rules will do (live: on the next job run), would do (preview) or would do if on (off).
 * - exception: in the queue ("Exception: ...") or resolved ("Resolved: ..."); otherwise what live will record
 *   (live, before the job ran), would record (preview) or would record if on (off).
 */
export function outcomeView(o: InvoiceOutcome, mode: InvoiceRuleMode, recorded: RecordedState = null): OutcomeView {
  if (o.kind === 'ignore') return { label: 'Not a stock invoice', tone: 'gray' };
  if (o.kind === 'noop') return { label: `Applied: ${unitStatusLabel(o.status)}`, tone: 'green' };
  if (o.kind === 'apply') {
    const verb = o.status === 'sold' ? 'mark sold' : 'reserve';
    if (mode === 'live') return { label: `Queued: ${verb}`, tone: 'yellow' };
    if (mode === 'preview') return { label: `Preview: would ${verb}`, tone: 'teal' };
    return { label: `Rules off: would ${verb}`, tone: 'gray' };
  }
  const reason = EXCEPTION_REASON_LABEL[o.reason];
  if (recorded === 'open') return { label: `Exception: ${reason}`, tone: 'red' };
  if (recorded === 'resolved') return { label: `Resolved: ${reason}`, tone: 'gray' };
  if (mode === 'live') return { label: `Queued: exception, ${reason}`, tone: 'yellow' };
  if (mode === 'preview') return { label: `Preview: exception, ${reason}`, tone: 'yellow' };
  return { label: `Rules off: exception, ${reason}`, tone: 'gray' };
}

/** Xero status as shown ("AUTHORISED" -> "Authorised"); paid-in-part shows as such. */
export function xeroStatusLabel(status: string | null, amountDue: number | string | null, total?: number | string | null): string {
  const s = (status ?? '').trim().toUpperCase();
  if (!s) return '—';
  const due = num(amountDue);
  const tot = num(total ?? null);
  if ((s === 'AUTHORISED' || s === 'SUBMITTED') && due !== null && tot !== null && due > 0 && due < tot) return 'Partly paid';
  return s.charAt(0) + s.slice(1).toLowerCase();
}

export interface IdsPayload {
  kind: 'ids';
  invoice_ids: string[];
  credit_note_ids: string[];
  rev?: number;
}

/**
 * Merges invoice and credit note ids into a pending job's payload. Returns the merged lists, or null when the pending
 * payload is not an ids payload or the merge would exceed max ids (then the caller queues a new job).
 */
export function mergeIdsPayload(pending: unknown, add: { invoice_ids?: readonly string[]; credit_note_ids?: readonly string[] }, max = MAX_IDS_PER_JOB): { invoice_ids: string[]; credit_note_ids: string[] } | null {
  if (!pending || typeof pending !== 'object') return null;
  const p = pending as { kind?: unknown; invoice_ids?: unknown; credit_note_ids?: unknown };
  if (p.kind !== 'ids') return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const invoice_ids = [...new Set([...list(p.invoice_ids), ...(add.invoice_ids ?? [])])];
  const credit_note_ids = [...new Set([...list(p.credit_note_ids), ...(add.credit_note_ids ?? [])])];
  return invoice_ids.length + credit_note_ids.length <= max ? { invoice_ids, credit_note_ids } : null;
}

/** Back-compatible: invoice ids only. */
export function mergeInvoiceIds(pending: unknown, add: readonly string[], max = MAX_IDS_PER_JOB): string[] | null {
  return mergeIdsPayload(pending, { invoice_ids: add }, max)?.invoice_ids ?? null;
}

/** An outbox row may take merged ids only while nothing has tried it yet (pending, attempts 0). */
export function mayMergeInto(job: { status: string; attempts: number } | null | undefined): boolean {
  return !!job && job.status === 'pending' && job.attempts === 0;
}

/**
 * stock.invoices runs one job at a time per org: a job waits when another running job for the org was claimed
 * before it (same instant: the smaller id goes first). Stuck jobs are released after 10 minutes (releaseStuck).
 */
export function mustWait(self: { id: string; locked_at: string | null }, running: ReadonlyArray<{ id: string; locked_at: string | null }>): boolean {
  const t = (v: string | null) => (v ? Date.parse(v) : 0);
  return running.some((o) => o.id !== self.id && (t(o.locked_at) < t(self.locked_at) || (t(o.locked_at) === t(self.locked_at) && o.id < self.id)));
}

const LIVE_STATUSES = new Set(['AUTHORISED', 'SUBMITTED', 'PAID']);

/**
 * Other live sales invoices (authorised, submitted or paid; different number) whose reference names the same VIN.
 * One invoice covers one unit: when two do, neither is applied and both become 'vin_on_several_invoices'.
 */
export function otherInvoicesNamingVin(self: Pick<MirrorInvoiceRow, 'invoice_id' | 'invoice_number'>, vin: string, candidates: readonly MirrorInvoiceRow[]): MirrorInvoiceRow[] {
  const mine = normalizeInvoiceNumber(self.invoice_number);
  return candidates.filter((c) => {
    if (c.invoice_id === self.invoice_id) return false;
    const type = (c.invoice_type ?? 'ACCREC').trim().toUpperCase();
    if (type !== 'ACCREC' || !LIVE_STATUSES.has((c.status ?? '').trim().toUpperCase())) return false;
    if (mine && normalizeInvoiceNumber(c.invoice_number) === mine) return false;
    return matchedVin(extractVin(c.reference, [vin])) === vin;
  });
}

/** One recorded exception for an (invoice, reason). */
export interface RecordedException {
  resolved: boolean;
  source_updated_utc: string | null;
}

/**
 * Whether the rules should skip raising this exception again: 'open' when one is in the queue; 'resolved' when one
 * was resolved for the same or a later Xero state (a resolved one never hides a later change); else null.
 */
export function recordedState(entries: readonly RecordedException[] | undefined, updatedUtc: string | null): RecordedState {
  if (!entries?.length) return null;
  if (entries.some((e) => !e.resolved)) return 'open';
  const t = updatedUtc ? Date.parse(updatedUtc) : null;
  if (entries.some((e) => t === null || (e.source_updated_utc !== null && Date.parse(e.source_updated_utc) >= t))) return 'resolved';
  return null;
}

export type CreditNoteOutcome =
  | { kind: 'ignore'; reason: 'not_sales' | 'status' | 'not_stock' }
  | { kind: 'exception'; reason: 'credit_note'; unitId: string; vin: string };

/**
 * A sales credit note (ACCRECCREDIT, authorised or paid) is a stock exception when its reference names a unit VIN,
 * or it is allocated to an invoice that a unit holds or whose reference names a unit VIN. Nothing changes the unit.
 */
export function creditNoteOutcome(cn: MirrorCreditNoteRow, allocated: readonly Pick<MirrorInvoiceRow, 'invoice_number' | 'reference'>[], units: readonly UnitFacts[]): CreditNoteOutcome {
  if ((cn.credit_note_type ?? '').trim().toUpperCase() !== 'ACCRECCREDIT') return { kind: 'ignore', reason: 'not_sales' };
  if (!LIVE_STATUSES.has((cn.status ?? '').trim().toUpperCase())) return { kind: 'ignore', reason: 'status' };
  const vins = units.map((u) => u.vin_norm);
  const byVin = (ref: string | null) => {
    const v = matchedVin(extractVin(ref, vins));
    return v ? units.find((u) => u.vin_norm === v) ?? null : null;
  };
  let unit = byVin(cn.reference);
  for (const inv of allocated) {
    if (unit) break;
    const n = normalizeInvoiceNumber(inv.invoice_number);
    unit = (n ? units.find((u) => normalizeInvoiceNumber(u.invoice_number) === n) : undefined) ?? byVin(inv.reference);
  }
  return unit ? { kind: 'exception', reason: 'credit_note', unitId: unit.id, vin: unit.vin_norm } : { kind: 'ignore', reason: 'not_stock' };
}

/** Distinct, non-empty invoice ids (Xero ids are uuids; anything else is dropped). */
export function cleanInvoiceIds(ids: readonly unknown[]): string[] {
  return [...new Set(ids.filter((x): x is string => typeof x === 'string' && /^[0-9a-fA-F-]{36}$/.test(x)))];
}

/** The success line for a manual apply (plan 7.5 copy), from stock_apply_invoice's result. */
export function manualResultMessage(result: unknown): string {
  const r = (result && typeof result === 'object' ? result : {}) as { result?: unknown; status?: unknown; invoice_number?: unknown };
  if (r.result === 'sold') return 'Fully paid: unit marked Sold.';
  if (r.result === 'reserved') return 'Unpaid: unit reserved.';
  if (r.result === 'noop') {
    const inv = normalizeInvoiceNumber(typeof r.invoice_number === 'string' ? r.invoice_number : null);
    return `No change: the unit is already ${unitStatusLabel(typeof r.status === 'string' ? r.status : null)}${inv ? ` on ${inv}` : ''}.`;
  }
  return 'No stock record has been changed.';
}
