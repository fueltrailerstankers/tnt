// Redaction for anything stored for display or written to logs: names, emails, phone numbers, addresses, tax
// and ID numbers, and uploaded file names. Ids, numbers (quote, invoice), statuses, VINs, amounts and product
// lines stay, so a dry run can still be checked against what Make did. Pure.
import type { Effect, FileSource, PlannedRequest } from './types';

export const REDACTED = '[redacted]';
export const REDACTED_FILE = '[file]';

/** Xero and form keys that carry personal data. */
const PERSONAL_KEYS = new Set([
  'Name', 'FirstName', 'LastName', 'EmailAddress', 'Phones', 'Addresses', 'TaxNumber', 'CompanyNumber',
  'ContactPersons', 'AttentionTo', 'BankAccountDetails', 'AccountNumber', 'SkypeUserName',
  // form fields
  'Email', 'COSTOMERDETAILS', 'IDNO', 'CONTACTNO', 'Address', 'CostomerVatNo', 'BusinessRegNo', 'fileName', 'FileName',
]);

export function redactValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redactValue);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, PERSONAL_KEYS.has(k) ? (x === null || x === undefined ? x : REDACTED) : redactValue(x)]));
  }
  if (typeof v === 'string') return redactString(v);
  return v;
}

const EMAIL = /[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+/g;
const LONG_DIGITS = /\b\d[\d ]{8,}\d\b/g; // phone and ID numbers (quote and invoice numbers are shorter)

/** Masks emails and long digit runs inside free text. Company inboxes in recipients are not passed here. */
export function redactString(s: string): string {
  return s.replace(EMAIL, REDACTED).replace(LONG_DIGITS, REDACTED);
}

function redactFile(f: FileSource): Record<string, unknown> {
  return f.kind === 'entry_file'
    ? { kind: f.kind, entryId: f.entryId, fileId: f.fileId, field: f.field, fileName: REDACTED_FILE, contentType: f.contentType, size: f.size }
    : { kind: f.kind, formSlug: f.formSlug, entryId: f.entryId, template: f.template, name: f.name };
}

/** Attachment uploads carry the file name in the path: mask it for uploaded files (generated documents keep it). */
export function redactPath(path: string, file?: FileSource): string {
  if (file?.kind === 'entry_file') return path.replace(/(\/Attachments\/)[^/?]+/, `$1${REDACTED_FILE}`);
  return path;
}

export interface DisplayRequest {
  step: string;
  method: string;
  path: string;
  params?: Record<string, string>;
  body?: unknown;
  file?: Record<string, unknown>;
  purpose: string;
}

export function redactRequest(r: PlannedRequest): DisplayRequest {
  return {
    step: r.step,
    method: r.method,
    path: redactPath(r.path, r.file),
    ...(r.params ? { params: redactValue(r.params) as Record<string, string> } : {}),
    ...(r.body !== undefined ? { body: redactValue(r.body) } : {}),
    ...(r.file ? { file: redactFile(r.file) } : {}),
    purpose: r.purpose,
  };
}

export function redactEffect(e: Effect): Record<string, unknown> {
  switch (e.kind) {
    case 'entry.patch':
      return { kind: e.kind, formSlug: e.formSlug, entryId: e.entryId, fields: redactValue(e.fields) };
    case 'entry.submit':
      return { kind: e.kind, formSlug: e.formSlug, values: redactValue(e.values) };
    case 'entry.update':
      return { kind: e.kind, formSlug: e.formSlug, entryId: e.entryId, values: redactValue(e.values) };
    case 'external_ref':
      return { ...e };
    case 'email':
      return { kind: e.kind, eventKey: e.eventKey, subject: redactString(e.subject), fields: e.lines.map(([k]) => k), attach: e.attach };
  }
}

/** Errors stored for display: an HTTP status and Xero's error type only, never messages (they can echo data). */
export function redactError(e: unknown): string {
  if (e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number') {
    const t = (e as { xeroType?: string }).xeroType;
    return `xero ${(e as { status: number }).status}${t ? ` ${t.replace(/[^A-Za-z]/g, '').slice(0, 40)}` : ''}`;
  }
  if (e instanceof Error) return redactString(e.message).slice(0, 200);
  return 'failed';
}
