// Invoice -> stock rules (stock plan 5.5, docs/M6.md section 3). Pure.
// "One invoice covers one unit." Unpaid or partly paid -> reserved; fully paid -> sold. Everything doubtful is an
// exception that changes nothing. stock_apply_invoice (0011) re-checks the VIN match and the conflicts in the
// database, so this decides what to ask for and shows previews; the RPC has the last word.

import { partKey } from './models';
import type { UnitStatus } from './kpi';
import { extractVin, matchedVin, type VinMatch } from './vin';

export const EXCEPTION_REASONS = [
  'voided',
  'deleted',
  'credit_note',
  'credited',
  'unknown_status',
  'unexpected_amount',
  'missing_invoice_number',
  'missing_vin',
  'vin_not_found',
  'vin_ambiguous',
  'invoice_linked_other_unit',
  'unit_linked_other_invoice',
  'unit_sold',
] as const;
export type ExceptionReason = (typeof EXCEPTION_REASONS)[number];

/** A xero_invoices mirror row (or the manual form), plus optional line item codes. */
export interface InvoiceFacts {
  invoice_id: string | null;
  invoice_number: string | null;
  /** ACCREC (sales), ACCPAY (bills), ACCRECCREDIT / ACCPAYCREDIT (credit notes). Missing = ACCREC. */
  invoice_type: string | null;
  status: string | null;
  amount_due: number | null;
  amount_credited?: number | null;
  reference: string | null;
  /** Line item codes. A line for a stock model marks the invoice as a stock invoice even without a known VIN. */
  item_codes?: readonly (string | null)[];
}

export interface UnitFacts {
  id: string;
  vin_norm: string;
  status: UnitStatus;
  invoice_number: string | null;
}

export interface UnitMatch {
  vin: VinMatch;
  /** The unit whose VIN the reference names (exact or contained). */
  unit: UnitFacts | null;
  /** Another unit already holding this invoice number. */
  holder: UnitFacts | null;
}

export type InvoiceOutcome =
  | { kind: 'ignore'; reason: 'draft' | 'not_sales' | 'not_stock' }
  | { kind: 'noop'; status: 'reserved' | 'sold'; unitId: string; vin: string }
  | { kind: 'apply'; status: 'reserved' | 'sold'; from: UnitStatus; unitId: string; vin: string }
  | { kind: 'exception'; reason: ExceptionReason; unitId: string | null; vin: string | null };

const RESERVE_STATUSES = new Set(['AUTHORISED', 'SUBMITTED']);

/** Invoice numbers compare upper case and trimmed ("inv-0042 " = "INV-0042"), as stored by the RPCs. */
export function normalizeInvoiceNumber(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  return s || null;
}

/** Looks the invoice up against the org's units: the unit its reference names, and any unit holding its number. */
export function matchUnit(invoice: Pick<InvoiceFacts, 'reference' | 'invoice_number'>, units: readonly UnitFacts[]): UnitMatch {
  const vin = extractVin(invoice.reference, units.map((u) => u.vin_norm));
  const v = matchedVin(vin);
  const unit = v ? units.find((u) => u.vin_norm === v) ?? null : null;
  const inv = normalizeInvoiceNumber(invoice.invoice_number);
  const holder = inv ? units.find((u) => u.id !== unit?.id && normalizeInvoiceNumber(u.invoice_number) === inv) ?? null : null;
  return { vin, unit, holder };
}

/**
 * What an invoice does to stock.
 * - Bills (ACCPAY*) and drafts are ignored. An invoice is a stock invoice when its reference names a known VIN (or
 *   several) or one of its lines is a stock model; any other sales invoice is ignored (parts, services).
 * - Credit notes, voided/deleted invoices, credited invoices and unknown statuses -> exception.
 * - PAID -> sold. AUTHORISED/SUBMITTED with amount due > 0 (incl. partly paid) -> reserved.
 * - Missing/unknown/ambiguous VIN, invoice on another unit, unit on another invoice, or a sold unit invoiced as
 *   unpaid -> exception. The same state twice -> noop.
 */
export function invoiceOutcome(invoice: InvoiceFacts, match: UnitMatch, modelParts: readonly string[] = []): InvoiceOutcome {
  const type = (invoice.invoice_type ?? 'ACCREC').trim().toUpperCase();
  const status = (invoice.status ?? '').trim().toUpperCase();
  if (type.startsWith('ACCPAY')) return { kind: 'ignore', reason: 'not_sales' };
  if (status === 'DRAFT') return { kind: 'ignore', reason: 'draft' };

  const models = new Set(modelParts.map(partKey));
  const namesVin = match.vin.kind === 'exact' || match.vin.kind === 'contained' || match.vin.kind === 'ambiguous';
  const hasModelLine = (invoice.item_codes ?? []).some((c) => !!c && models.has(partKey(c)));
  if (!namesVin && !hasModelLine) return { kind: 'ignore', reason: 'not_stock' };

  const unitId = match.unit?.id ?? null;
  const vin = match.unit?.vin_norm ?? null;
  const exception = (reason: ExceptionReason): InvoiceOutcome => ({ kind: 'exception', reason, unitId, vin });

  if (type.endsWith('CREDIT')) return exception('credit_note');
  if (status === 'VOIDED') return exception('voided');
  if (status === 'DELETED') return exception('deleted');
  if (status !== 'PAID' && !RESERVE_STATUSES.has(status)) return exception('unknown_status');
  if ((invoice.amount_credited ?? 0) > 0) return exception('credited');
  const inv = normalizeInvoiceNumber(invoice.invoice_number);
  if (!inv) return exception('missing_invoice_number');

  let target: 'reserved' | 'sold';
  if (status === 'PAID') target = 'sold';
  else if ((invoice.amount_due ?? 0) > 0) target = 'reserved';
  else return exception('unexpected_amount');

  if (match.vin.kind === 'missing') return exception('missing_vin');
  if (match.vin.kind === 'none') return exception('vin_not_found');
  if (match.vin.kind === 'ambiguous') return exception('vin_ambiguous');
  if (!match.unit) return exception('vin_not_found');

  const unit = match.unit;
  if (match.holder && match.holder.id !== unit.id) return exception('invoice_linked_other_unit');
  const unitInv = normalizeInvoiceNumber(unit.invoice_number);
  if (unitInv && unitInv !== inv) return exception('unit_linked_other_invoice');
  if (unit.status === 'sold' && target === 'reserved') return exception('unit_sold');
  if (unit.status === target && unitInv === inv) return { kind: 'noop', status: target, unitId: unit.id, vin: unit.vin_norm };
  return { kind: 'apply', status: target, from: unit.status, unitId: unit.id, vin: unit.vin_norm };
}

/** The p_outcome argument for stock_apply_invoice, or null when there is nothing to send (ignore, noop). */
export function rpcOutcome(o: InvoiceOutcome): 'reserved' | 'sold' | `exception:${ExceptionReason}` | null {
  if (o.kind === 'apply') return o.status;
  if (o.kind === 'exception') return `exception:${o.reason}`;
  return null;
}
