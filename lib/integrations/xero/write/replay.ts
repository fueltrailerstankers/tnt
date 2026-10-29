// Make parity harness core (scripts/replay-make.ts). Pure: no network, no database.
//
// Input: recorded Make executions (format "tt-make-replay/1", documented in docs/M3.md): the form entry Make
// received, the Xero objects Make read (raw Xero JSON), and the requests Make sent to Xero (plus, for actions
// that write our entries, the field values Make wrote). Each execution is run through the planner in dry run
// and the planned requests are diffed against Make's. Values that carry personal data are redacted in the
// report; the comparison itself uses the full values.
import { mapContact, mapInvoice, mapQuote } from '../mappers';
import { planDealImport } from './plan-deal';
import { planDeliveryInvoice } from './plan-delivery';
import { planMerge } from './plan-merge';
import { planRelease } from './plan-release';
import { planRfiInvoice } from './plan-rfi';
import { REDACTED, redactString } from './redact';
import {
  isActionName, type ActionName, type AttachmentIn, type ContactIn, type EntryIn, type FileIn, type InvoiceIn, type Plan, type QuoteIn, type QuoteLineIn,
} from './types';

type J = Record<string, unknown>;

export const REPLAY_FORMAT = 'tt-make-replay/1';

export interface MakeRequest {
  method: string;
  path: string;
  body?: unknown;
}

export interface Execution {
  id: string;
  action: ActionName;
  scenario?: number;
  entry?: EntryIn;
  files?: FileIn[];
  documentName?: string;
  today?: string;
  xero?: { quotes?: J[]; contacts?: J[]; invoices?: J[]; attachments?: J[] };
  /** Delivery Note: the RFI behind it. */
  rfi?: { entry: EntryIn; documentName: string } | null;
  /** Release: entry already mapped to the invoice. */
  existingReleaseEntryId?: string | null;
  /** Dotted body paths to ignore in the comparison (e.g. a date Make took from its run time). */
  ignore?: string[];
  make: {
    requests: MakeRequest[];
    /** Field values Make wrote to the form entry (DEAL import, RELEASE FORM create). */
    entry?: Record<string, unknown>;
  };
}

export interface ReplayFile {
  format: string;
  executions: Execution[];
}

export interface ExecutionReport {
  id: string;
  action: string;
  planStatus: Plan['status'];
  reason?: string;
  match: boolean;
  lines: string[];
}

// ---------------------------------------------------------------------------------------------------
// Inputs from raw Xero JSON (the same row shapes the runner reads from the mirror)
// ---------------------------------------------------------------------------------------------------
const lower = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

function quotesOf(x: Execution['xero']): { quotes: QuoteIn[]; lines: QuoteLineIn[] } {
  const mapped = (x?.quotes ?? []).map(mapQuote);
  return {
    quotes: mapped.map((m) => ({ quote_id: m.row.quote_id, quote_number: m.row.quote_number, status: m.row.status, contact_id: m.row.contact_id, quote_date: m.row.quote_date, currency_code: m.row.currency_code, total: m.row.total, raw: m.row.raw })),
    lines: mapped[0]?.lines ?? [],
  };
}
const contactsOf = (x: Execution['xero']): ContactIn[] => (x?.contacts ?? []).map(mapContact).map((c) => ({ contact_id: c.contact_id, name: c.name, first_name: c.first_name, last_name: c.last_name, email: c.email }));
const invoicesOf = (x: Execution['xero']): InvoiceIn[] =>
  (x?.invoices ?? []).map(mapInvoice).map(({ row: r }) => ({
    invoice_id: r.invoice_id, invoice_number: r.invoice_number, invoice_type: r.invoice_type, reference: r.reference, status: r.status, contact_id: r.contact_id,
    contact_name: r.contact_name, total: r.total, amount_due: r.amount_due, fully_paid_on: r.fully_paid_on, currency_code: r.currency_code,
  }));

export function planExecution(ex: Execution): Plan {
  const entry = ex.entry ?? { id: 'replay-entry', number: 0, status: 'Submitted', updatedAt: '1970-01-01T00:00:00.000Z', data: {} };
  switch (ex.action) {
    case 'deal.import_quote': {
      const q = quotesOf(ex.xero);
      return planDealImport({ entry, quotes: q.quotes, lines: q.lines });
    }
    case 'rfi.create_invoice': {
      const q = quotesOf(ex.xero);
      const contacts = contactsOf(ex.xero);
      const quoteContact = contacts.find((c) => c.contact_id === q.quotes[0]?.contact_id) ?? null;
      const n = (entry.data.Name ?? {}) as J;
      const full = [n.First, n.Last].filter((v) => typeof v === 'string' && v.trim()).join(' ');
      const typed = typeof entry.data.QuoteNo === 'string' ? entry.data.QuoteNo : '';
      return planRfiInvoice({
        entry, files: ex.files ?? [], documentName: ex.documentName ?? 'REQUEST FOR INVOICE.pdf', quotes: q.quotes, quoteLines: q.lines, quoteContact,
        contactsByEmail: quoteContact?.email ? contacts.filter((c) => lower(c.email) === lower(quoteContact.email)) : [],
        contactsByName: full ? contacts.filter((c) => lower(c.name) === lower(full)) : [],
        invoicesByReference: invoicesOf(ex.xero).filter((i) => typed && (lower(i.reference) === lower(typed) || lower(i.reference) === lower(typed.replace(/^QU-?/i, '')))),
        today: ex.today ?? '1970-01-01',
      });
    }
    case 'delivery.update_invoice':
      return planDeliveryInvoice({ entry, files: ex.files ?? [], documentName: ex.documentName ?? 'DELIVERY NOTE.pdf', invoices: invoicesOf(ex.xero), rfi: ex.rfi ?? null });
    case 'release.on_paid': {
      const inv = invoicesOf(ex.xero)[0];
      if (!inv) throw new Error(`${ex.id}: release needs one invoice`);
      const email = contactsOf(ex.xero).find((c) => c.contact_id === inv.contact_id)?.email ?? null;
      return planRelease({ invoice: inv, contactEmail: email, existingReleaseEntryId: ex.existingReleaseEntryId ?? null });
    }
    case 'invoice.merge_attachments': {
      const inv = invoicesOf(ex.xero)[0];
      if (!inv) throw new Error(`${ex.id}: merge needs one invoice`);
      const atts: AttachmentIn[] = (ex.xero?.attachments ?? []).map((a) => ({ attachment_id: String(a.AttachmentID), file_name: (a.FileName as string) ?? null, mime_type: (a.MimeType as string) ?? null, content_length: Number(a.ContentLength ?? 0) }));
      return planMerge({ invoice: inv, attachments: atts });
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------------------------------
const PERSONAL = /(^|\.)(Name|FirstName|LastName|EmailAddress|Phones|Addresses|TaxNumber|CompanyNumber|Email|COSTOMERDETAILS|IDNO)(\.|$)/;
const PLACEHOLDER = /^\{\{[a-z_]+\}\}$/;

function show(path: string, v: unknown): string {
  if (v === undefined) return '(absent)';
  if (PERSONAL.test(path)) return REDACTED;
  return redactString(JSON.stringify(v));
}

const decode = (p: string) => {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
};

/** Path match where {{x}} in ours matches any one segment; attachment names are masked in reports. */
export function pathMatches(ours: string, theirs: string): boolean {
  const a = decode(ours).split('?')[0].split('/');
  const b = decode(theirs).split('?')[0].split('/');
  return a.length === b.length && a.every((s, i) => s === b[i] || /^\{\{[a-z_]+\}\}$/.test(s));
}

/** Deep diff; {{x}} placeholders in ours match any value. Returns dotted paths with both sides. */
export function diffValues(ours: unknown, theirs: unknown, path = '', ignore: string[] = []): Array<{ path: string; ours: unknown; theirs: unknown }> {
  if (ignore.includes(path)) return [];
  if (typeof ours === 'string' && PLACEHOLDER.test(ours)) return theirs === undefined ? [{ path, ours, theirs }] : [];
  if (Array.isArray(ours) && Array.isArray(theirs)) {
    const out = [];
    for (let i = 0; i < Math.max(ours.length, theirs.length); i++) out.push(...diffValues(ours[i], theirs[i], path ? `${path}.${i}` : String(i), ignore));
    return out;
  }
  if (ours && theirs && typeof ours === 'object' && typeof theirs === 'object' && !Array.isArray(ours) && !Array.isArray(theirs)) {
    const keys = [...new Set([...Object.keys(ours), ...Object.keys(theirs)])].sort();
    return keys.flatMap((k) => diffValues((ours as J)[k], (theirs as J)[k], path ? `${path}.${k}` : k, ignore));
  }
  if (typeof ours === 'number' && typeof theirs === 'string' && Number(theirs) === ours) return [];
  return JSON.stringify(ours) === JSON.stringify(theirs) ? [] : [{ path, ours, theirs }];
}

const maskPath = (p: string) => p.replace(/(\/Attachments\/)[^/?]+/, '$1[file]');

export function compareExecution(ex: Execution): ExecutionReport {
  const plan = planExecution(ex);
  const lines: string[] = [];
  const theirs = ex.make.requests.map((r, i) => ({ ...r, i, used: false }));
  let lastIndex = -1;
  let ordered = true;
  for (const r of plan.requests) {
    const hit = theirs.find((t) => !t.used && t.method.toUpperCase() === r.method && pathMatches(r.path, t.path));
    if (!hit) {
      lines.push(`  + only in platform: ${r.method} ${maskPath(r.path)} (${r.step})`);
      continue;
    }
    hit.used = true;
    if (hit.i < lastIndex) ordered = false;
    lastIndex = hit.i;
    if (r.file) continue; // raw bodies: same request and file name is the parity check
    const d = diffValues(r.body, hit.body, '', ex.ignore ?? []);
    for (const x of d) lines.push(`  ~ ${r.method} ${maskPath(r.path)} ${x.path}: platform ${show(x.path, x.ours)} / make ${show(x.path, x.theirs)}`);
  }
  for (const t of theirs.filter((x) => !x.used)) lines.push(`  - only in Make: ${t.method.toUpperCase()} ${maskPath(t.path)}`);
  if (!ordered) lines.push('  ! same requests, different order');

  if (ex.make.entry) {
    const eff = plan.effects.find((e) => e.kind === 'entry.patch' || e.kind === 'entry.submit' || e.kind === 'entry.update');
    const ours = eff ? (eff.kind === 'entry.patch' ? eff.fields : eff.values) : {};
    for (const x of diffValues(ours, ex.make.entry, '', ex.ignore ?? [])) {
      // An entry patch only lists fields that change; a field Make wrote with the value already there is not a difference.
      if (eff?.kind === 'entry.patch' && x.ours === undefined && ex.entry && JSON.stringify(ex.entry.data[x.path]) === JSON.stringify(x.theirs)) continue;
      lines.push(`  ~ entry ${x.path}: platform ${show(x.path, x.ours)} / make ${show(x.path, x.theirs)}`);
    }
  }
  return { id: ex.id, action: ex.action, planStatus: plan.status, reason: plan.reason, match: lines.length === 0, lines };
}

export function parseReplayFile(json: unknown): ReplayFile {
  const f = json as ReplayFile;
  if (!f || f.format !== REPLAY_FORMAT || !Array.isArray(f.executions)) throw new Error(`not a ${REPLAY_FORMAT} file`);
  for (const ex of f.executions) {
    if (!ex.id || !isActionName(ex.action) || !ex.make || !Array.isArray(ex.make.requests)) throw new Error(`bad execution ${String(ex?.id)}`);
  }
  return f;
}

export function replay(file: ReplayFile): { reports: ExecutionReport[]; matched: number; differing: number; text: string } {
  const reports = file.executions.map(compareExecution);
  const text = reports.map((r) => `${r.match ? 'MATCH' : 'DIFF '} ${r.id} [${r.action}] plan=${r.planStatus}${r.reason ? ` (${r.reason})` : ''}${r.lines.length ? `\n${r.lines.join('\n')}` : ''}`).join('\n');
  const matched = reports.filter((r) => r.match).length;
  return { reports, matched, differing: reports.length - matched, text: `${text}\n\n${matched} of ${reports.length} executions match Make.` };
}
