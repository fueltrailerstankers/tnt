// Reading, normalising and validating entry values. Pure; the server is authoritative.
//
// Form field naming (what the renderer emits and readFormData reads):
//   f.<Field>               text, textarea, email, date, number, choice (repeated for checkboxes), lookup
//   f.<Field>.<Part>        name (First, Last) and address parts
//   cl.<itemNo>.<fail|pass|comments>   inspection checklist rows
//   file.<Field>            JSON: FileRef[] (staged uploads plus kept existing files)
//   sig.<Field>             PNG data URL of a new signature, or "keep:<fileId>"
// M8 types:
//   f.<Field>               phone, url, currency (amount), time (HH:MM), datetime (YYYY-MM-DDTHH:MM in the
//                           org timezone), yesno ("yes" | "no"; a toggle posts "yes" when on), rating (1-5)
//   f.<Field>.other         choice "Other" free text (the choice itself posts OTHER_VALUE)
//
// Stored values (entries.data): phone { phone, digits }, url string, currency { amount, currency },
// time "HH:MM", datetime UTC ISO, yesno boolean, rating integer; choice "Other" stores the typed text.
//
// This module imports the spec module for types only, so the browser renderer can run the same reading,
// show-when and validation code without bundling zod.
import { errorMessage, parseErrorWhen } from './expressions';
import { formatZoned, timeIn, zonedToUtc } from './time';
import type { ChecklistItem, FieldSpec, FormSpec, InputField } from './types';
import { hiddenNames, isChecklistSection, isHeading } from './visibility';

export type EntryData = Record<string, unknown>;

export interface ChecklistRow {
  itemNo: number;
  label: string;
  fail: boolean;
  pass: boolean;
  comments: string;
}

/** A file in a file field: either a staged upload (path under staging/) or an existing entry_files row. */
export type FileRef =
  | { kind: 'staged'; path: string; name: string; size: number; type: string }
  | { kind: 'existing'; id: string };

export type SignatureInput = { kind: 'new'; dataUrl: string } | { kind: 'keep'; id: string } | null;

export interface ReadResult {
  data: EntryData;
  files: Record<string, FileRef[]>;
  signatures: Record<string, SignatureInput>;
  errors: Record<string, string>;
}

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_SIGNATURE_BYTES = 512 * 1024;
const DEFAULT_MAX_FILES = 10;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const PHONE_RE = /^\+?[0-9()\-.\s]+$/;
const AMOUNT_RE = /^-?\d+(\.\d{1,2})?$/;
/** Posted by a choice field's "Other" option; the typed text comes in f.<Field>.other. */
export const OTHER_VALUE = '__other__';
const MAX_URL = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PNG_DATA_URL_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;
const MAX_TEXT = 10_000;

type Getter = { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] };

// Local copy of types.ts inputFields so this module stays free of zod at runtime (see the header).
function inputFields(spec: FormSpec): InputField[] {
  return spec.fields.filter((f): f is InputField => f.type !== 'content' && f.type !== 'pagebreak');
}

function fieldNamed(spec: FormSpec, name: string): InputField | undefined {
  return inputFields(spec).find((f) => f.name === name);
}

export interface ReadOptions {
  /** Org timezone: datetime fields are entered in it and stored as UTC. Default UTC. */
  timeZone?: string;
  /** Org currency code for currency fields that do not name one. Default USD. */
  currency?: string;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '';
}

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function digitsOf(s: string): string {
  return s.replace(/\D/g, '');
}

/** https only. A bare host ("example.com/x") gets https:// in front. Null when not acceptable. */
export function normaliseUrl(raw: string): string | null {
  const v = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  if (v.length > MAX_URL || /\s/.test(v)) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password) return null;
  return u.toString();
}

function currencyOf(f: { currency?: string }, opts: ReadOptions): string {
  return f.currency ?? opts.currency ?? 'USD';
}

/** Parses posted form data into normalised entry data and file/signature intents. Records type errors. */
export function readFormData(spec: FormSpec, fd: Getter, opts: ReadOptions = {}): ReadResult {
  const data: EntryData = {};
  const files: Record<string, FileRef[]> = {};
  const signatures: Record<string, SignatureInput> = {};
  const errors: Record<string, string> = {};

  for (const f of inputFields(spec)) {
    const key = `f.${f.name}`;
    switch (f.type) {
      case 'text': {
        let v = str(fd.get(key));
        if (f.pattern === 'uppercase') v = v.toUpperCase();
        if (v && f.pattern === 'alphanumeric' && !/^[A-Za-z0-9 ]+$/.test(v)) errors[f.name] = 'Use letters and numbers only.';
        if (v) data[f.name] = v;
        break;
      }
      case 'textarea': {
        const v = str(fd.get(key));
        if (v) data[f.name] = v;
        break;
      }
      case 'phone': {
        const v = str(fd.get(key));
        if (!v) break;
        const digits = digitsOf(v);
        if (!PHONE_RE.test(v) || digits.length < 9 || digits.length > 15) errors[f.name] = 'Enter a valid phone number (at least 9 digits).';
        else data[f.name] = { phone: v, digits };
        break;
      }
      case 'url': {
        const v = str(fd.get(key));
        if (!v) break;
        const u = normaliseUrl(v);
        if (!u) errors[f.name] = 'Enter a valid https:// link.';
        else data[f.name] = u;
        break;
      }
      case 'currency': {
        const v = str(fd.get(key)).replace(/[\s,]/g, '');
        if (!v) break;
        if (!AMOUNT_RE.test(v) || !Number.isFinite(Number(v))) errors[f.name] = 'Enter an amount, for example 1500.00.';
        else data[f.name] = { amount: Number(v), currency: currencyOf(f, opts) };
        break;
      }
      case 'time': {
        const v = str(fd.get(key));
        if (v && !TIME_RE.test(v)) errors[f.name] = 'Enter a valid time (HH:MM).';
        else if (v) data[f.name] = v.slice(0, 5);
        break;
      }
      case 'datetime': {
        const v = str(fd.get(key));
        if (!v) break;
        const iso = zonedToUtc(v, opts.timeZone ?? 'UTC');
        if (!iso) errors[f.name] = 'Enter a valid date and time.';
        else data[f.name] = iso;
        break;
      }
      case 'yesno': {
        const v = str(fd.get(key));
        if (f.style === 'toggle') data[f.name] = v === 'yes';
        else if (v === 'yes' || v === 'no') data[f.name] = v === 'yes';
        else if (v) errors[f.name] = 'Choose Yes or No.';
        break;
      }
      case 'rating': {
        const v = str(fd.get(key));
        if (v && !/^[1-5]$/.test(v)) errors[f.name] = 'Choose a rating from 1 to 5.';
        else if (v) data[f.name] = Number(v);
        break;
      }
      case 'email': {
        const v = str(fd.get(key));
        if (v && !EMAIL_RE.test(v)) errors[f.name] = 'Enter a valid email address.';
        if (v) data[f.name] = v;
        break;
      }
      case 'date': {
        const v = str(fd.get(key));
        if (v && !validDate(v)) errors[f.name] = 'Enter a valid date.';
        else if (v) data[f.name] = v;
        break;
      }
      case 'number': {
        const v = str(fd.get(key));
        if (!v) break;
        const n = Number(v);
        if (!Number.isFinite(n) || (f.integer && !Number.isInteger(n))) errors[f.name] = f.integer ? 'Enter a whole number.' : 'Enter a number.';
        else data[f.name] = n;
        break;
      }
      case 'choice': {
        let raw = f.multi ? fd.getAll(key).map(str).filter(Boolean) : [str(fd.get(key))].filter(Boolean);
        if (f.other && raw.includes(OTHER_VALUE)) {
          const other = str(fd.get(`${key}.other`)).slice(0, 500);
          if (!other) {
            errors[f.name] = 'Enter a value for Other.';
            break;
          }
          raw = [...raw.filter((v) => v !== OTHER_VALUE && v !== other), other];
          const bad = raw.slice(0, -1).find((v) => !f.options.includes(v));
          if (bad) errors[f.name] = 'Choose one of the listed options.';
          else data[f.name] = f.multi ? raw : other;
          break;
        }
        const bad = raw.find((v) => !f.options.includes(v));
        if (bad) errors[f.name] = 'Choose one of the listed options.';
        else if (raw.length) data[f.name] = f.multi ? raw : raw[0];
        break;
      }
      case 'name':
      case 'address': {
        const obj: Record<string, string> = {};
        for (const p of f.parts) {
          const v = str(fd.get(`${key}.${p}`));
          if (v) obj[p] = v;
        }
        if (Object.keys(obj).length) data[f.name] = obj;
        break;
      }
      case 'lookup': {
        const v = str(fd.get(key));
        if (v && !UUID_RE.test(v)) errors[f.name] = 'Choose an entry from the list.';
        else if (v) data[f.name] = v;
        break;
      }
      case 'section': {
        // Headings (M8) hold no value; the kit checklist section reads its rows.
        if (spec.checklist && isChecklistSection(f)) data.checklist = readChecklist(spec.checklist, fd);
        break;
      }
      case 'file': {
        const refs = parseFileRefs(fd.get(`file.${f.name}`));
        if (refs === null) errors[f.name] = 'Upload failed. Try adding the file again.';
        else files[f.name] = refs;
        break;
      }
      case 'signature': {
        const v = str(fd.get(`sig.${f.name}`));
        if (!v) signatures[f.name] = null;
        else if (v.startsWith('keep:') && UUID_RE.test(v.slice(5))) signatures[f.name] = { kind: 'keep', id: v.slice(5) };
        else if (PNG_DATA_URL_RE.test(v) && v.length <= (MAX_SIGNATURE_BYTES * 4) / 3 + 64) signatures[f.name] = { kind: 'new', dataUrl: v };
        else errors[f.name] = 'Signature could not be read. Sign again.';
        break;
      }
      case 'table':
        break; // read-only panel, nothing stored
    }
  }
  return { data, files, signatures, errors };
}

function readChecklist(items: ChecklistItem[], fd: Getter): ChecklistRow[] {
  return items.map((it) => ({
    itemNo: it.itemNo,
    label: it.label,
    fail: fd.get(`cl.${it.itemNo}.fail`) === 'on',
    pass: fd.get(`cl.${it.itemNo}.pass`) === 'on',
    comments: str(fd.get(`cl.${it.itemNo}.comments`)),
  }));
}

function parseFileRefs(v: FormDataEntryValue | null): FileRef[] | null {
  if (v === null || v === '') return [];
  if (typeof v !== 'string') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(v);
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length > 50) return null;
  const out: FileRef[] = [];
  for (const r of raw) {
    if (r && r.kind === 'existing' && typeof r.id === 'string' && UUID_RE.test(r.id)) out.push({ kind: 'existing', id: r.id });
    else if (
      r && r.kind === 'staged' && typeof r.path === 'string' && /^staging\/[0-9a-f-]{36}\/[A-Za-z0-9_]+\/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$/.test(r.path) &&
      typeof r.name === 'string' && r.name.length <= 255 && typeof r.size === 'number' && r.size > 0 && r.size <= MAX_FILE_BYTES &&
      typeof r.type === 'string' && r.type.length <= 255
    ) out.push({ kind: 'staged', path: r.path, name: r.name, size: r.size, type: r.type });
    else return null;
  }
  return out;
}

export function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).every(isEmptyValue);
  return false;
}

export interface ValidateOptions {
  /** Fields not to validate: hidden by showWhen, or locked for the actor (prepareSave's `skip`). */
  skip?: Iterable<string>;
}

/**
 * Required fields, lengths and ranges (M8), file limits and the spec's customError rules. Returns
 * field -> message. fileCounts: number of files/signatures each file-like field will hold after the save.
 */
export function validateEntry(spec: FormSpec, data: EntryData, fileCounts: Record<string, number>, opts: ValidateOptions = {}): Record<string, string> {
  const errors: Record<string, string> = {};
  const skip = new Set(opts.skip ?? []);
  const ctx = {
    isEmpty: (name: string) => isEmptyValue(data[name]) && (fileCounts[name] ?? 0) === 0,
    fileCount: (name: string) => fileCounts[name] ?? 0,
  };
  for (const f of inputFields(spec)) {
    if (skip.has(f.name) || isHeading(f)) continue;
    if (isRequired(f)) {
      const v = data[f.name];
      const missing =
        f.type === 'name' ? f.parts.some((p) => isEmptyValue((v as Record<string, unknown> | undefined)?.[p]))
        : f.type === 'yesno' && f.style === 'toggle' ? v !== true
        : ctx.isEmpty(f.name);
      if (missing) errors[f.name] = 'This field is required.';
    }
    if (!errors[f.name]) {
      const range = rangeError(f, data[f.name]);
      if (range) errors[f.name] = range;
    }
    if (f.type === 'file') {
      const n = fileCounts[f.name] ?? 0;
      const max = f.multi ? (f.maxFiles ?? DEFAULT_MAX_FILES) : 1;
      if (n > max) errors[f.name] = `Upload at most ${max} file${max === 1 ? '' : 's'}.`;
    }
    if ('customError' in f && f.customError && !errors[f.name]) {
      if (parseErrorWhen(f.customError.when).test(ctx)) errors[f.name] = errorMessage(f.customError.message);
    }
  }
  return errors;
}

function isRequired(f: InputField): boolean {
  return 'required' in f && f.required === true;
}

/** min/max length (text, textarea) and min/max value (number, currency, date, time). */
function rangeError(f: InputField, v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if ((f.type === 'text' || f.type === 'textarea') && typeof v === 'string') {
    if (f.minLength !== undefined && v.length < f.minLength) return `Enter at least ${f.minLength} characters.`;
    if (f.maxLength !== undefined && v.length > f.maxLength) return `Enter at most ${f.maxLength} characters.`;
  }
  if (f.type === 'number' || f.type === 'currency') {
    const n = f.type === 'currency' ? (v as { amount?: unknown }).amount : v;
    if (typeof n === 'number') {
      if (f.min !== undefined && n < f.min) return `Enter ${f.min} or more.`;
      if (f.max !== undefined && n > f.max) return `Enter ${f.max} or less.`;
    }
  }
  if ((f.type === 'date' || f.type === 'time') && typeof v === 'string') {
    const what = f.type === 'date' ? 'a date' : 'a time';
    if (f.min !== undefined && v < f.min) return `Enter ${what} on or after ${f.min}.`;
    if (f.max !== undefined && v > f.max) return `Enter ${what} on or before ${f.max}.`;
  }
  return null;
}

// --- who may change what, and show-when (M8) -------------------------------------------------------

export type Audience = 'public' | 'staff';

/** Fields the public role may not change: readOnly (shown) and internalOnly (not shown). */
export function lockedFor(spec: FormSpec, audience: Audience): Set<string> {
  const out = new Set<string>();
  if (audience !== 'public') return out;
  for (const f of inputFields(spec)) if (('readOnly' in f && f.readOnly) || ('internalOnly' in f && f.internalOnly)) out.add(f.name);
  return out;
}

export interface PreparedSave {
  /** What to store: locked fields keep `previous`, hidden fields are dropped. */
  data: EntryData;
  /** Fields not validated, and whose files are left as they are: hidden or locked. */
  skip: Set<string>;
  /** The read errors that still apply (none for skipped fields). */
  errors: Record<string, string>;
}

/**
 * Applies the M8 rules to what was read from a post. Locked fields (lockedFor) keep `previous`: the saved
 * entry's data, or the defaults for a new entry. Fields hidden by showWhen are dropped and not validated.
 * The same function runs in the browser before submitting, so both sides agree.
 */
export function prepareSave(spec: FormSpec, read: Pick<ReadResult, 'data' | 'errors'>, ctx: { audience: Audience; previous: EntryData }): PreparedSave {
  const locked = lockedFor(spec, ctx.audience);
  const data = applyLocks(spec, read.data, ctx);
  const hidden = hiddenNames(spec, data);
  for (const name of hidden) {
    const f = fieldNamed(spec, name);
    if (f && isChecklistSection(f)) delete data.checklist;
    else delete data[name];
  }
  const skip = new Set([...locked, ...hidden]);
  const errors = Object.fromEntries(Object.entries(read.errors).filter(([k]) => !skip.has(k)));
  return { data, skip, errors };
}

/** A copy of `data` where the fields the audience may not change hold `previous` values. */
export function applyLocks(spec: FormSpec, data: EntryData, ctx: { audience: Audience; previous: EntryData }): EntryData {
  const out: EntryData = { ...data };
  for (const name of lockedFor(spec, ctx.audience)) {
    if (ctx.previous[name] !== undefined) out[name] = ctx.previous[name];
    else delete out[name];
  }
  return out;
}

/** Files/signatures each field will hold according to the post (the browser's view of planFiles' counts). */
export function postedFileCounts(read: Pick<ReadResult, 'files' | 'signatures'>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, refs] of Object.entries(read.files)) out[k] = refs.length;
  for (const [k, s] of Object.entries(read.signatures)) out[k] = s ? 1 : 0;
  return out;
}

/**
 * The browser's check before submitting: the same reading, locking, show-when and validation the server
 * runs (runAction), so required and show-when are enforced on both sides. Returns field -> message.
 */
export function checkPost(spec: FormSpec, fd: Getter, ctx: ReadOptions & { audience: Audience; previous: EntryData }): Record<string, string> {
  const read = readFormData(spec, fd, ctx);
  const prep = prepareSave(spec, read, ctx);
  return { ...validateEntry(spec, prep.data, postedFileCounts(read), { skip: prep.skip }), ...prep.errors };
}

/** Drops internalOnly fields from a spec, for the public form (their labels never reach the browser). */
export function publicSpec(spec: FormSpec): FormSpec {
  const internal = (f: FieldSpec) => 'internalOnly' in f && f.internalOnly === true;
  if (!spec.fields.some(internal)) return spec;
  return { ...spec, fields: spec.fields.filter((f) => !internal(f)) };
}

/** Drops internalOnly values from entry data shown to the public role (role links). */
export function publicData(spec: FormSpec, data: EntryData): EntryData {
  const out = { ...data };
  for (const f of inputFields(spec)) if ('internalOnly' in f && f.internalOnly) delete out[f.name];
  return out;
}

// --- display ----------------------------------------------------------------------------------------

export interface DisplayOptions {
  /** Org timezone for datetime values. Default UTC. */
  timeZone?: string;
}

/** Renders the entry summary template, e.g. "[QUOTENO]" or "[Name]" (name renders "First Last"). */
export function renderSummary(template: string, data: EntryData, ctx?: { spec: FormSpec } & DisplayOptions): string {
  return template
    .replace(/\[([A-Za-z_][A-Za-z0-9_]*)\]/g, (_, k: string) => (ctx ? formatValue(fieldNamed(ctx.spec, k), data[k], ctx) : displayValue(data[k])))
    .trim()
    .slice(0, 200);
}

/** "ZAR 1,234.50". */
export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Plain-text rendering of a stored value, for summaries, grids, exports, emails and PDFs. */
export function displayValue(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.map(displayValue).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.amount === 'number' && typeof o.currency === 'string') return formatMoney(o.amount, o.currency);
    if (typeof o.phone === 'string' && typeof o.digits === 'string') return o.phone;
    if ('First' in o || 'Last' in o) return [o.First, o.Last].filter(Boolean).join(' ');
    return Object.values(o).map(displayValue).filter(Boolean).join(', ');
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

/** displayValue with the field's type: datetime in the org timezone, rating "4/5". */
export function formatValue(f: FieldSpec | undefined, v: unknown, opts: DisplayOptions = {}): string {
  if (v === undefined || v === null || v === '') return '';
  if (f?.type === 'datetime' && typeof v === 'string') return formatZoned(v, opts.timeZone ?? 'UTC');
  if (f?.type === 'rating' && typeof v === 'number') return `${v}/5`;
  return displayValue(v);
}

export interface DefaultOptions {
  /** YYYY-MM-DD in the org timezone, for date default 'today'. */
  today?: string;
  /** The current instant, for time/datetime default 'now' (needs timeZone for time). */
  now?: Date;
  timeZone?: string;
  /** Org currency code for currency fields that do not name one. */
  currency?: string;
}

/** Initial values for a new entry: every type's default from the spec. `today` is YYYY-MM-DD in the org timezone. */
export function defaultData(spec: FormSpec, opts: DefaultOptions = {}): EntryData {
  const d: EntryData = {};
  for (const f of inputFields(spec)) {
    if ((f.type === 'choice' || f.type === 'email') && f.default) d[f.name] = f.type === 'choice' && f.multi ? [f.default] : f.default;
    if (f.type === 'date' && f.default === 'today' && opts.today) d[f.name] = opts.today;
    // M8 defaults
    if (f.type === 'date' && f.default && f.default !== 'today') d[f.name] = f.default;
    if ((f.type === 'text' || f.type === 'textarea') && f.default) d[f.name] = f.type === 'text' && f.pattern === 'uppercase' ? f.default.toUpperCase() : f.default;
    if (f.type === 'url' && f.default) d[f.name] = normaliseUrl(f.default) ?? f.default;
    if (f.type === 'phone' && f.default) d[f.name] = { phone: f.default, digits: digitsOf(f.default) };
    if ((f.type === 'number' || f.type === 'rating') && f.default !== undefined) d[f.name] = f.default;
    if (f.type === 'currency' && f.default !== undefined) d[f.name] = { amount: f.default, currency: currencyOf(f, opts) };
    if (f.type === 'yesno' && f.default !== undefined) d[f.name] = f.default;
    if (f.type === 'time' && f.default) {
      if (f.default !== 'now') d[f.name] = f.default;
      else if (opts.now) d[f.name] = timeIn(opts.timeZone ?? 'UTC', opts.now);
    }
    if (f.type === 'datetime' && f.default === 'now' && opts.now) {
      d[f.name] = new Date(Math.floor(opts.now.getTime() / 60_000) * 60_000).toISOString();
    }
  }
  return d;
}

/** Today's date (YYYY-MM-DD) in a timezone. */
export function todayIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
