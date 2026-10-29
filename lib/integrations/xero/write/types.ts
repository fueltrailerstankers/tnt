// Shared types for the M3 Xero actions. Pure.
//
// A planner turns (entry data + mirror rows) into a Plan: the ordered Xero write requests it would send, the
// non-Xero effects (our own entries, emails, mappings) and the expected end state. Plans are data. Only
// writer.ts sends requests, and only in live mode with a claimed idempotency key.

export const ACTIONS = [
  'deal.import_quote',
  'rfi.create_invoice',
  'delivery.update_invoice',
  'release.on_paid',
  'invoice.merge_attachments',
] as const;
export type ActionName = (typeof ACTIONS)[number];

export function isActionName(v: unknown): v is ActionName {
  return typeof v === 'string' && (ACTIONS as readonly string[]).includes(v);
}

/** Outbox queue that runs an action. */
export const queueOf = (a: ActionName) => `xero.${a}`;

export type WriteMethod = 'POST' | 'PUT';

/** Raw request body for an attachment upload: a stored entry file or a generated entry document. */
export type FileSource =
  | { kind: 'entry_file'; entryId: string; fileId: string; field: string; fileName: string; contentType: string | null; size: number | null }
  | { kind: 'document'; formSlug: string; entryId: string; template: number; name: string };

export interface PlannedRequest {
  /** Stable id within the action's idempotency key; with the key it forms the action_claims key. */
  step: string;
  method: WriteMethod;
  /** Path under /api.xro/2.0. May hold {{capture}} placeholders filled from earlier responses. */
  path: string;
  params?: Record<string, string>;
  /** JSON body. May hold {{capture}} placeholders. */
  body?: unknown;
  /** Raw body (attachments). */
  file?: FileSource;
  /** Remember a value from the JSON response, e.g. { name: 'invoice', path: 'Invoices.0.InvoiceID' }. */
  capture?: { name: string; path: string };
  /** What the request is for, in plain words. No personal data. */
  purpose: string;
}

export type Effect =
  | { kind: 'entry.patch'; formSlug: string; entryId: string; fields: Record<string, unknown> }
  | { kind: 'entry.submit'; formSlug: string; values: Record<string, string> }
  | { kind: 'entry.update'; formSlug: string; entryId: string; values: Record<string, string> }
  | { kind: 'external_ref'; entity: string; externalId: string; internalId: string; needsLive?: boolean }
  | { kind: 'email'; eventKey: string; subject: string; lines: Array<[string, string]>; attach: string[] };

export interface Plan {
  action: ActionName;
  idempotencyKey: string;
  /** ready = run it; skip = nothing to do (reason); retry = inputs not ready yet, try again later (reason). */
  status: 'ready' | 'skip' | 'retry';
  reason?: string;
  requests: PlannedRequest[];
  effects: Effect[];
  expected: Record<string, unknown>;
}

export function emptyPlan(action: ActionName, idempotencyKey: string, status: Plan['status'], reason: string): Plan {
  return { action, idempotencyKey, status, reason, requests: [], effects: [], expected: {} };
}

// ---------------------------------------------------------------------------------------------------
// Planner inputs: subsets of the mirror rows (0006) so the runner and the replay harness can share them.
// ---------------------------------------------------------------------------------------------------
export interface QuoteIn {
  quote_id: string;
  quote_number: string | null;
  status: string | null;
  contact_id: string | null;
  quote_date: string | null;
  currency_code: string | null;
  total: number | string | null;
  raw: Record<string, unknown>;
}
export interface QuoteLineIn {
  line_no: number;
  item_code: string | null;
  description: string | null;
  quantity: number | string | null;
  unit_amount: number | string | null;
}
export interface ContactIn {
  contact_id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}
export interface InvoiceIn {
  invoice_id: string;
  invoice_number: string | null;
  invoice_type: string | null;
  reference: string | null;
  status: string | null;
  contact_id: string | null;
  contact_name: string | null;
  total: number | string | null;
  amount_due: number | string | null;
  fully_paid_on: string | null;
  currency_code: string | null;
}
export interface AttachmentIn {
  attachment_id: string;
  file_name: string | null;
  mime_type: string | null;
  content_length: number | null;
}
export interface FileIn {
  id: string;
  fieldKey: string;
  kind: 'file' | 'signature' | 'document';
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  sortOrder: number;
}
export interface EntryIn {
  id: string;
  number: number;
  status: string;
  updatedAt: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------------
// Small pure helpers used by planners and the writer.
// ---------------------------------------------------------------------------------------------------
export const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

/** Xero attachment names travel in the URL path: keep them short and free of separators. */
export function safeFileName(name: string): string {
  const s = name.replace(/[\\/:*?"<>|#%{}\r\n\t]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
  return s || 'file';
}

const PLACEHOLDER = /\{\{([a-z][a-z0-9_]*)\}\}/g;

/** Fills {{name}} placeholders in strings, arrays and objects. Unknown names throw (a step ran out of order). */
export function fillPlaceholders<T>(value: T, captures: Record<string, string>): T {
  const fill = (s: string) =>
    s.replace(PLACEHOLDER, (_, n: string) => {
      if (!(n in captures)) throw new Error(`missing capture ${n}`);
      return captures[n];
    });
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return fill(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** Reads "Invoices.0.InvoiceID" from a JSON value. */
export function pick(json: unknown, path: string): unknown {
  let cur: unknown = json;
  for (const k of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = Array.isArray(cur) ? cur[Number(k)] : (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export const money = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
