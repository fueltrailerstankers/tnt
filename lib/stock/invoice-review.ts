// Invoice review and the stock.invoices job: mirror rows -> invoiceOutcome, labels, payload merging. Pure.
// The job (lib/stock/invoice-job.ts) and the Invoice review page evaluate invoices with the same function, so the
// page shows exactly what the job does (preview) or did (applied). stock_apply_invoice re-checks in the database.

import { zonedDayStart } from '@/lib/admin/grid';
import type { Tone } from '@/lib/ui/status';
import { EXCEPTION_REASON_LABEL, unitStatusLabel } from './errors';
import { invoiceOutcome, matchUnit, normalizeInvoiceNumber, type InvoiceOutcome, type UnitFacts } from './invoice';
import type { UnitStatus } from './kpi';
import type { InvoiceRuleMode } from './settings';

export const STOCK_INVOICES_QUEUE = 'stock.invoices';
/** Invoice ids merged into one pending job at most; beyond that a new job is queued. */
export const MAX_IDS_PER_JOB = 500;

/** The xero_invoices columns the rules read. */
export const MIRROR_INVOICE_COLUMNS = 'invoice_id, invoice_number, invoice_type, status, amount_due, amount_credited, reference, updated_utc';

export interface MirrorInvoiceRow {
  invoice_id: string;
  invoice_number: string | null;
  invoice_type: string | null;
  status: string | null;
  amount_due: number | string | null;
  amount_credited: number | string | null;
  reference: string | null;
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
    amount_credited: num(row.amount_credited),
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

/**
 * The outcome chip on Invoice review.
 * - noop: the unit already reflects the invoice ("Applied: Reserved" / "Applied: Sold"), in any mode.
 * - apply: what the rules will do (live: on the next job run), would do (preview) or would do if on (off).
 * - exception: in live the queue below holds it; in preview it is what live would record.
 */
export function outcomeView(o: InvoiceOutcome, mode: InvoiceRuleMode): OutcomeView {
  if (o.kind === 'ignore') return { label: 'Not a stock invoice', tone: 'gray' };
  if (o.kind === 'noop') return { label: `Applied: ${unitStatusLabel(o.status)}`, tone: 'green' };
  if (o.kind === 'apply') {
    const verb = o.status === 'sold' ? 'mark sold' : 'reserve';
    if (mode === 'live') return { label: `Queued: ${verb}`, tone: 'yellow' };
    if (mode === 'preview') return { label: `Preview: would ${verb}`, tone: 'teal' };
    return { label: `Rules off: would ${verb}`, tone: 'gray' };
  }
  const reason = EXCEPTION_REASON_LABEL[o.reason];
  if (mode === 'live') return { label: `Exception: ${reason}`, tone: 'red' };
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

/**
 * Merges invoice ids into a pending job's payload. Returns the merged list, or null when the pending payload is
 * not an ids payload or the merge would exceed max (then the caller queues a new job).
 */
export function mergeInvoiceIds(pending: unknown, add: readonly string[], max = MAX_IDS_PER_JOB): string[] | null {
  if (!pending || typeof pending !== 'object') return null;
  const p = pending as { kind?: unknown; invoice_ids?: unknown };
  if (p.kind !== 'ids' || !Array.isArray(p.invoice_ids)) return null;
  const merged = [...new Set([...p.invoice_ids.filter((x): x is string => typeof x === 'string'), ...add])];
  return merged.length <= max ? merged : null;
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
