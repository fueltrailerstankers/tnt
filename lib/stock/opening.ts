// Opening stock import (docs/M6.md section 4, Pilot setup): CSV -> validated unit rows -> dry-run report -> plan.
// Pure. The setup server action reads the org's models, locations and units, calls these, and applies the plan
// with the service role (idempotent by VIN: a VIN already registered is left as it is).
// Reports never echo cell values except VINs and model codes (line numbers and field names only).

import { DEAL_LOCATION_MAP } from './deal';
import { normalizeInvoiceNumber } from './invoice';
import type { UnitStatus } from './kpi';
import { partKey } from './models';
import { normalizeVin, VIN_MAX_LENGTH, VIN_MIN_LENGTH } from './vin';

export const OPENING_COLUMNS = ['vin', 'model', 'location', 'status', 'invoice', 'deal_year', 'sequence', 'dispatch_date', 'notes'] as const;
export type OpeningColumn = (typeof OPENING_COLUMNS)[number];
export const REQUIRED_COLUMNS: readonly OpeningColumn[] = ['vin', 'model', 'location', 'status'];

export const COLUMN_LABEL: Record<OpeningColumn, string> = {
  vin: 'VIN', model: 'Model', location: 'Location', status: 'Status', invoice: 'Invoice', deal_year: 'Deal year',
  sequence: 'Sequence', dispatch_date: 'Dispatch date', notes: 'Notes',
};

/** The header line of the template users download. */
export const OPENING_TEMPLATE_HEADER = OPENING_COLUMNS.map((c) => COLUMN_LABEL[c]).join(',');

export const OPENING_MAX_ROWS = 5000;
/** Below the 1 MB server action body limit. */
export const OPENING_MAX_CHARS = 900_000;
const MAX_LISTED = 200;

const HEADER_ALIASES: Record<string, OpeningColumn> = {
  vin: 'vin', 'vin number': 'vin', 'vin no': 'vin', 'chassis number': 'vin',
  model: 'model', 'model part': 'model', 'part number': 'model', 'part no': 'model', part: 'model', 'model part number': 'model',
  location: 'location', branch: 'location',
  status: 'status',
  invoice: 'invoice', 'invoice number': 'invoice', 'invoice no': 'invoice',
  'deal year': 'deal_year', year: 'deal_year',
  sequence: 'sequence', 'sequence number': 'sequence', 'sequence no': 'sequence', 'deal number': 'sequence',
  'dispatch date': 'dispatch_date', 'date dispatched': 'dispatch_date',
  notes: 'notes', note: 'notes',
};

const headerKey = (h: string) => h.replace(/^﻿/, '').trim().toLowerCase().replace(/[_\-./]+/g, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------------

export interface CsvRecord {
  /** 1-based line of the file where the record starts (the header is line 1). */
  line: number;
  cells: string[];
}

/** Comma or semicolon: whichever the header line uses more (Excel in some locales writes semicolons). */
export function detectDelimiter(text: string): ',' | ';' {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  return (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
}

/** RFC 4180 CSV: quoted fields with "" escapes and line breaks, CRLF or LF, a leading BOM. Blank records dropped. */
export function parseCsv(text: string, delimiter: ',' | ';' = detectDelimiter(text)): CsvRecord[] {
  const s = text.replace(/^﻿/, '');
  const out: CsvRecord[] = [];
  let cells: string[] = [];
  let cur = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  const endRecord = () => {
    cells.push(cur);
    if (cells.some((c) => c.trim() !== '')) out.push({ line: start, cells });
    cells = [];
    cur = '';
  };
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else {
        if (ch === '\n') line += 1;
        cur += ch;
      }
      continue;
    }
    if (ch === '"' && cur.trim() === '') {
      quoted = true;
      cur = '';
    } else if (ch === delimiter) {
      cells.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      start = line;
    } else cur += ch;
  }
  if (cur !== '' || cells.length) endRecord();
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------------

export interface OpeningRow {
  line: number;
  vin: string;
  model: string;
  location: string;
  status: UnitStatus;
  invoice: string | null;
  dealYear: number | null;
  sequence: number | null;
  dispatchDate: string | null;
  notes: string | null;
}

export interface LineIssue {
  line: number;
  field: OpeningColumn | 'row';
  message: string;
}

export interface OpeningContext {
  /** Model part numbers of the org (stock_models). */
  models: readonly string[];
  /** Locations of the org (stock_locations). */
  locations: ReadonlyArray<{ id: string; name: string }>;
}

export interface ParsedOpening {
  missingColumns: OpeningColumn[];
  /** Data records in the file (header excluded). */
  totalRows: number;
  tooManyRows: boolean;
  /** Rows without any problem, in file order. */
  rows: OpeningRow[];
  errors: LineIssue[];
  /** VINs that appear on more than one line. */
  duplicates: Array<{ vin: string; lines: number[] }>;
  unknownModels: Array<{ model: string; lines: number[] }>;
  unknownLocationLines: number[];
  /** Lines whose invoice number appears on another line too. */
  duplicateInvoiceLines: number[];
  /** Reserved or sold rows without an invoice number (allowed; listed for a check). */
  noInvoiceLines: number[];
}

const STATUSES: readonly UnitStatus[] = ['available', 'reserved', 'sold'];

/** "2026-03-01", "2026/03/01" or "01/03/2026" (day first) -> "2026-03-01"; null when not a real date. */
export function parseDispatchDate(v: string): string | null {
  const s = v.trim();
  let y: number, m: number, d: number;
  let r: RegExpExecArray | null;
  if ((r = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s))) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return null;
  if (y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const intOrNull = (v: string): number | null | 'bad' => {
  const s = v.trim();
  if (!s) return null;
  return /^\d{1,9}$/.test(s) ? Number(s) : 'bad';
};

/** Location by id ("CPT"), DEAL code ("DUR") or name ("Cape Town"), case-insensitive. */
export function matchLocation(v: string, locations: OpeningContext['locations']): string | null {
  const s = v.trim();
  if (!s) return null;
  const up = s.toUpperCase();
  const byId = locations.find((l) => l.id === up) ?? locations.find((l) => l.id === DEAL_LOCATION_MAP[up]);
  if (byId) return byId.id;
  return locations.find((l) => l.name.trim().toLowerCase() === s.toLowerCase())?.id ?? null;
}

const push = <K>(m: Map<K, number[]>, k: K, line: number) => m.set(k, [...(m.get(k) ?? []), line]);

/** Parses and checks an opening stock CSV against the org's models and locations. */
export function parseOpeningCsv(text: string, ctx: OpeningContext): ParsedOpening {
  const records = parseCsv(text);
  const empty: ParsedOpening = {
    missingColumns: [], totalRows: 0, tooManyRows: false, rows: [], errors: [], duplicates: [], unknownModels: [],
    unknownLocationLines: [], duplicateInvoiceLines: [], noInvoiceLines: [],
  };
  if (!records.length) return { ...empty, missingColumns: [...REQUIRED_COLUMNS] };

  const index = new Map<OpeningColumn, number>();
  records[0].cells.forEach((h, i) => {
    const col = HEADER_ALIASES[headerKey(h)];
    if (col && !index.has(col)) index.set(col, i);
  });
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !index.has(c));
  const data = records.slice(1);
  if (missingColumns.length) return { ...empty, missingColumns, totalRows: data.length };
  if (data.length > OPENING_MAX_ROWS) return { ...empty, totalRows: data.length, tooManyRows: true };

  const models = new Map(ctx.models.map((p) => [partKey(p), p]));
  const cell = (r: CsvRecord, c: OpeningColumn) => (index.has(c) ? (r.cells[index.get(c)!] ?? '').trim() : '');
  const errors: LineIssue[] = [];
  const unknownModels = new Map<string, number[]>();
  const unknownLocationLines: number[] = [];
  const byVin = new Map<string, number[]>();
  const byInvoice = new Map<string, number[]>();
  const candidates: OpeningRow[] = [];

  for (const r of data) {
    const issues: LineIssue[] = [];
    const bad = (field: LineIssue['field'], message: string) => issues.push({ line: r.line, field, message });

    const vin = normalizeVin(cell(r, 'vin'));
    if (!vin) bad('vin', 'VIN is missing.');
    else if (vin.length < VIN_MIN_LENGTH || vin.length > VIN_MAX_LENGTH) bad('vin', `VIN must be ${VIN_MIN_LENGTH} to ${VIN_MAX_LENGTH} characters.`);
    else push(byVin, vin, r.line);

    const rawModel = cell(r, 'model');
    const model = models.get(partKey(rawModel)) ?? null;
    if (!rawModel) bad('model', 'Model is missing.');
    else if (!model) {
      push(unknownModels, partKey(rawModel).slice(0, 40), r.line);
      bad('model', 'Model is not one of the stock models.');
    }

    const rawLocation = cell(r, 'location');
    const location = matchLocation(rawLocation, ctx.locations);
    if (!rawLocation) bad('location', 'Location is missing.');
    else if (!location) {
      unknownLocationLines.push(r.line);
      bad('location', 'Location is not a stock location (Factory or a branch).');
    }

    const rawStatus = cell(r, 'status').toLowerCase();
    const status = (STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as UnitStatus) : null;
    if (!status) bad('status', 'Status must be available, reserved or sold.');

    const rawInvoice = cell(r, 'invoice');
    const invoice = normalizeInvoiceNumber(rawInvoice);
    if (invoice && invoice.length > 50) bad('invoice', 'Invoice number is too long (50 characters at most).');
    else if (invoice) push(byInvoice, invoice, r.line);

    const dealYear = intOrNull(cell(r, 'deal_year'));
    const sequence = intOrNull(cell(r, 'sequence'));
    if (dealYear === 'bad' || (typeof dealYear === 'number' && (dealYear < 2000 || dealYear > 2100))) bad('deal_year', 'Deal year must be a year between 2000 and 2100.');
    if (sequence === 'bad' || sequence === 0) bad('sequence', 'Sequence must be a whole number above 0.');
    if ((dealYear === null) !== (sequence === null) && dealYear !== 'bad' && sequence !== 'bad') {
      bad('row', 'Enter both the deal year and the sequence, or neither.');
    }

    const rawDate = cell(r, 'dispatch_date');
    const dispatchDate = rawDate ? parseDispatchDate(rawDate) : null;
    if (rawDate && !dispatchDate) bad('dispatch_date', 'Dispatch date must be a date like 2026-03-01.');

    const notes = cell(r, 'notes');
    if (notes.length > 2000) bad('notes', 'Notes are too long (2000 characters at most).');

    if (issues.length) {
      errors.push(...issues);
      continue;
    }
    candidates.push({
      line: r.line, vin: vin!, model: model!, location: location!, status: status!, invoice,
      dealYear: dealYear as number | null, sequence: sequence as number | null, dispatchDate, notes: notes || null,
    });
  }

  const duplicates = [...byVin].filter(([, lines]) => lines.length > 1).map(([vin, lines]) => ({ vin, lines }));
  const dupVins = new Set(duplicates.map((d) => d.vin));
  const duplicateInvoiceLines = [...byInvoice.values()].filter((l) => l.length > 1).flat().sort((a, b) => a - b);
  const dupInvoiceSet = new Set(duplicateInvoiceLines);
  const rows = candidates.filter((c) => !dupVins.has(c.vin) && !dupInvoiceSet.has(c.line));
  return {
    missingColumns: [],
    totalRows: data.length,
    tooManyRows: false,
    rows,
    errors,
    duplicates,
    unknownModels: [...unknownModels].map(([model, lines]) => ({ model, lines })),
    unknownLocationLines,
    duplicateInvoiceLines,
    noInvoiceLines: rows.filter((r) => r.status !== 'available' && !r.invoice).map((r) => r.line),
  };
}

// ---------------------------------------------------------------------------------------------------
// Plan against the register, report, rows to insert
// ---------------------------------------------------------------------------------------------------

export interface ExistingUnit {
  vin_norm: string;
  model_part: string;
  location_id: string;
  status: string;
  invoice_number: string | null;
}

export interface OpeningPlan {
  insert: OpeningRow[];
  /** VIN already registered: left unchanged (correct it on the unit). `same` = the file agrees with the register. */
  existing: Array<{ line: number; vin: string; same: boolean }>;
  /** The invoice number is already on another registered unit. */
  invoiceConflicts: Array<{ line: number; vin: string }>;
}

/** Splits valid rows into new units and VINs already registered (idempotent by VIN). */
export function planOpening(parsed: Pick<ParsedOpening, 'rows'>, units: readonly ExistingUnit[]): OpeningPlan {
  const byVin = new Map(units.map((u) => [u.vin_norm, u]));
  const invoiceOwner = new Map(units.filter((u) => u.invoice_number).map((u) => [u.invoice_number as string, u.vin_norm]));
  const plan: OpeningPlan = { insert: [], existing: [], invoiceConflicts: [] };
  for (const r of parsed.rows) {
    const u = byVin.get(r.vin);
    if (u) {
      const same = u.model_part === r.model && u.location_id === r.location && u.status === r.status && (u.invoice_number ?? null) === r.invoice;
      plan.existing.push({ line: r.line, vin: r.vin, same });
      continue;
    }
    const owner = r.invoice ? invoiceOwner.get(r.invoice) : undefined;
    if (owner && owner !== r.vin) {
      plan.invoiceConflicts.push({ line: r.line, vin: r.vin });
      continue;
    }
    plan.insert.push(r);
  }
  return plan;
}

export interface OpeningReport {
  totalRows: number;
  missingColumns: string[];
  tooManyRows: boolean;
  toInsert: number;
  alreadyRegistered: number;
  differing: number;
  /** VINs already registered whose register record differs from the file (left unchanged). */
  differingVins: string[];
  errorCount: number;
  /** First MAX_LISTED problems, by line number. */
  errors: LineIssue[];
  duplicates: Array<{ vin: string; lines: number[] }>;
  unknownModels: Array<{ model: string; lines: number[] }>;
  unknownLocationLines: number[];
  duplicateInvoiceLines: number[];
  invoiceConflicts: Array<{ line: number; vin: string }>;
  noInvoiceLines: number[];
  /** Apply is allowed: the file is clean and has new units. */
  canApply: boolean;
}

export function openingReport(parsed: ParsedOpening, plan: OpeningPlan): OpeningReport {
  const errorCount = parsed.errors.length + parsed.duplicates.length + parsed.duplicateInvoiceLines.length + plan.invoiceConflicts.length;
  const clean = !parsed.missingColumns.length && !parsed.tooManyRows && errorCount === 0;
  const differing = plan.existing.filter((e) => !e.same);
  return {
    totalRows: parsed.totalRows,
    missingColumns: parsed.missingColumns.map((c) => COLUMN_LABEL[c]),
    tooManyRows: parsed.tooManyRows,
    toInsert: plan.insert.length,
    alreadyRegistered: plan.existing.length,
    differing: differing.length,
    differingVins: differing.slice(0, MAX_LISTED).map((e) => e.vin),
    errorCount,
    errors: [...parsed.errors].sort((a, b) => a.line - b.line).slice(0, MAX_LISTED),
    duplicates: parsed.duplicates.slice(0, MAX_LISTED),
    unknownModels: parsed.unknownModels.slice(0, MAX_LISTED),
    unknownLocationLines: parsed.unknownLocationLines.slice(0, MAX_LISTED),
    duplicateInvoiceLines: parsed.duplicateInvoiceLines.slice(0, MAX_LISTED),
    invoiceConflicts: plan.invoiceConflicts.slice(0, MAX_LISTED),
    noInvoiceLines: parsed.noInvoiceLines.slice(0, MAX_LISTED),
    canApply: clean && plan.insert.length > 0,
  };
}

/** The stock_units insert for a new unit (service role; org and creator set by the server, never the file). */
export function unitInsert(r: OpeningRow, orgId: string, userId: string, nowIso: string) {
  return {
    org_id: orgId,
    vin: r.vin,
    model_part: r.model,
    location_id: r.location,
    status: r.status,
    invoice_number: r.invoice,
    deal_year: r.dealYear,
    sequence: r.sequence,
    dispatch_date: r.dispatchDate,
    notes: r.notes,
    sold_at: r.status === 'sold' ? nowIso : null,
    created_by: userId,
  };
}

/** "4, 9, 12" (and "and N more" past the first 20). */
export function lineList(lines: readonly number[], max = 20): string {
  const head = lines.slice(0, max).join(', ');
  return lines.length > max ? `${head} and ${lines.length - max} more` : head;
}
