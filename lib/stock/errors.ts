// Stock RPC errors -> the copy users see (stock plan 5.4 / 5.5). Pure.
// The RPCs in 0011 raise with message = code, hint = 'stock' and detail = JSON context (ids, VIN, model,
// location, status, deal year/number, invoice number).

import type { ExceptionReason } from './invoice';

export const STOCK_ERROR_CODES = [
  'FORBIDDEN',
  'INVALID_INPUT',
  'VIN_EXISTS',
  'FACTORY_UNIT_EXISTS',
  'DEAL_NOT_FOUND',
  'DEAL_DISMISSED',
  'DEAL_ALREADY_DISPATCHED',
  'DEAL_NOT_DISMISSED',
  'VIN_NOT_FOUND',
  'VIN_AMBIGUOUS',
  'UNIT_LINKED_OTHER_INVOICE',
  'INVOICE_LINKED_OTHER_UNIT',
  'UNIT_NOT_FOUND',
  'UNIT_SOLD',
  'UNIT_CHANGED',
  'MODEL_NOT_FOUND',
  'LOCATION_NOT_FOUND',
  'REASON_REQUIRED',
] as const;
export type StockErrorCode = (typeof STOCK_ERROR_CODES)[number];

export interface StockError {
  code: StockErrorCode;
  detail: Record<string, unknown>;
}

const isCode = (v: unknown): v is StockErrorCode => typeof v === 'string' && (STOCK_ERROR_CODES as readonly string[]).includes(v);

/**
 * Reads an error raised by a stock RPC: a PostgREST error ({ message, details, hint }) or a node-postgres one
 * ({ message, detail, hint }). Null for anything else (callers show their generic failure).
 */
export function parseStockError(err: unknown): StockError | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { message?: unknown; details?: unknown; detail?: unknown; hint?: unknown };
  if (e.hint !== 'stock' || !isCode(e.message)) return null;
  const raw = typeof e.details === 'string' ? e.details : typeof e.detail === 'string' ? e.detail : null;
  let detail: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) detail = parsed as Record<string, unknown>;
    } catch {
      detail = {};
    }
  }
  return { code: e.message, detail };
}

const STATUS_LABEL: Record<string, string> = { available: 'Available', reserved: 'Reserved', sold: 'Sold' };

/** "Available" / "Reserved" / "Sold". */
export function unitStatusLabel(status: string | null | undefined): string {
  return (status && STATUS_LABEL[status]) || '—';
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null);

export interface MessageOptions {
  /** Who may restore a dismissed deal. Defaults to "an admin" (the stock plan names the superuser). */
  restorer?: string;
  /** Location id -> display name, for details that carry only the id. */
  locationName?: (id: string) => string | undefined;
}

const GENERIC = 'Something went wrong. No stock record has been changed.';

function invalidInputMessage(detail: Record<string, unknown>): string {
  switch (detail.field) {
    case 'vin':
      return 'Enter the full VIN.';
    case 'accessories':
      return 'Record up to 10 accessory lines of up to 200 characters each.';
    case 'notes':
      return 'Notes are too long (2000 characters at most).';
    case 'reason':
      return 'The reason is too long (200 characters at most).';
    case 'deal':
      return detail.reason === 'unit_has_deal' ? 'This unit is already linked to a deal.' : 'Enter both the deal year and the sequence number.';
    case 'location':
      if (detail.reason === 'same_location') return 'The unit is already at this location.';
      if (detail.reason === 'factory_with_deal') return 'A deal is cleared when its unit reaches a branch. Choose a destination branch, or register the unit at the Factory without the deal.';
      return 'Choose a destination branch.';
    case 'status':
      return 'Choose a status.';
    case 'invoice_number':
      return 'Enter the invoice number.';
    case 'dispatch_date':
      return 'Enter a valid dispatch date.';
    default:
      return 'Check the values and try again.';
  }
}

/** The user-facing message for a stock RPC error. */
export function stockErrorMessage(e: StockError, opts: MessageOptions = {}): string {
  const d = e.detail;
  const location = () => {
    const id = str(d.location);
    return str(d.location_name) ?? (id ? opts.locationName?.(id) ?? id : '—');
  };
  switch (e.code) {
    case 'VIN_EXISTS':
      if (!str(d.model)) return 'VIN already used. Open the existing record instead.';
      return `VIN already used — ${str(d.model)}; sequence ${str(d.sequence) ?? '—'}; ${location()}; ${unitStatusLabel(str(d.status))}. Open the existing record instead.`;
    case 'FACTORY_UNIT_EXISTS': {
      const to = str(d.to);
      const branch = to ? opts.locationName?.(to) ?? to : 'a branch';
      return `This VIN is already registered at the Factory. Move this factory unit to ${branch} instead.`;
    }
    case 'DEAL_NOT_FOUND':
      return 'No matching deal for this year and number.';
    case 'DEAL_DISMISSED':
      return `This deal has been dismissed. Only ${opts.restorer ?? 'an admin'} can restore it before dispatch.`;
    case 'DEAL_ALREADY_DISPATCHED': {
      const deal = `Deal ${str(d.year) ?? '?'}/${str(d.number) ?? '?'}`;
      return str(d.vin) ? `${deal} was already dispatched with VIN ${str(d.vin)}.` : `${deal} was already dispatched.`;
    }
    case 'DEAL_NOT_DISMISSED':
      return 'This deal is not dismissed.';
    case 'VIN_NOT_FOUND':
      return 'VIN not found. No stock record has been changed.';
    case 'VIN_AMBIGUOUS':
      return 'The reference matches more than one VIN. No stock record has been changed.';
    case 'UNIT_LINKED_OTHER_INVOICE':
      return 'This unit is linked to another invoice. Review the conflict before proceeding.';
    case 'INVOICE_LINKED_OTHER_UNIT':
      return 'This invoice is linked to another unit. Review the conflict before proceeding.';
    case 'UNIT_NOT_FOUND':
      return 'Unit not found.';
    case 'UNIT_CHANGED':
      return 'This unit changed since you opened it. Reload and check.';
    case 'UNIT_SOLD':
      return 'This unit is sold. No stock record has been changed.';
    case 'MODEL_NOT_FOUND':
      return 'Choose a model from the list.';
    case 'LOCATION_NOT_FOUND':
      return 'Choose a destination branch.';
    case 'REASON_REQUIRED':
      return 'Enter a reason.';
    case 'FORBIDDEN':
      return 'You do not have permission for this action.';
    case 'INVALID_INPUT':
      return invalidInputMessage(d);
    default:
      return GENERIC;
  }
}

/** Message for any error from a stock RPC call (unknown errors get the generic copy, never raw database text). */
export function stockMessageFor(err: unknown, opts: MessageOptions = {}): string {
  const e = parseStockError(err);
  return e ? stockErrorMessage(e, opts) : GENERIC;
}

/** Fixed copy from the stock plan. */
export const STOCK_COPY = {
  dispatchSaved: 'Dispatch saved.',
  reservedToast: 'Unpaid: unit reserved.',
  soldToast: 'Fully paid: unit marked Sold.',
  vinCheckNote: 'VIN is checked against all records, including sold units.',
  dealClearsNote: 'A deal clears only when dispatch is completed against its year and number. Payment status is tracked separately.',
  freeDispatchNote: 'Dispatches without a deal number do not clear this list.',
  modelNotRecognised: 'Model not recognised',
} as const;

/** Find unit, found and outstanding: "Deal 2026 / 260 · 1000DB · Cape Town. Add or confirm the VIN and destination." */
export function dealFoundMessage(d: { year: number; number: number; model: string | null; branch: string | null }): string {
  return `Deal ${d.year} / ${d.number} · ${d.model ?? STOCK_COPY.modelNotRecognised} · ${d.branch ?? 'No branch'}. Add or confirm the VIN and destination.`;
}

/** Labels for the exceptions queue. */
export const EXCEPTION_REASON_LABEL: Record<ExceptionReason, string> = {
  voided: 'Invoice voided',
  deleted: 'Invoice deleted',
  credit_note: 'Credit note',
  credited: 'Invoice credited',
  unknown_status: 'Unexpected invoice status',
  unexpected_amount: 'Unpaid invoice with nothing due',
  missing_invoice_number: 'Invoice number missing',
  missing_vin: 'No VIN in the reference',
  vin_not_found: 'VIN not found',
  vin_ambiguous: 'Reference matches more than one VIN',
  invoice_linked_other_unit: 'Invoice linked to another unit',
  unit_linked_other_invoice: 'Unit linked to another invoice',
  unit_sold: 'Unit already sold',
  vin_on_several_invoices: 'VIN on more than one invoice',
};
