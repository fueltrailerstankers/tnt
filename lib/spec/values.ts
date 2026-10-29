// Reading, normalising and validating entry values. Pure; the server is authoritative.
//
// Form field naming (what the renderer emits and readFormData reads):
//   f.<Field>               text, textarea, email, date, number, choice (repeated for checkboxes), lookup
//   f.<Field>.<Part>        name (First, Last) and address parts
//   cl.<itemNo>.<fail|pass|comments>   inspection checklist rows
//   file.<Field>            JSON: FileRef[] (staged uploads plus kept existing files)
//   sig.<Field>             PNG data URL of a new signature, or "keep:<fileId>"
import { errorMessage, parseErrorWhen } from './expressions';
import { inputFields, type ChecklistItem, type FormSpec, type InputField } from './types';

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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PNG_DATA_URL_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;
const MAX_TEXT = 10_000;

type Getter = { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] };

function str(v: FormDataEntryValue | null): string {
  return typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '';
}

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Parses posted form data into normalised entry data and file/signature intents. Records type errors. */
export function readFormData(spec: FormSpec, fd: Getter): ReadResult {
  const data: EntryData = {};
  const files: Record<string, FileRef[]> = {};
  const signatures: Record<string, SignatureInput> = {};
  const errors: Record<string, string> = {};

  for (const f of inputFields(spec)) {
    const key = `f.${f.name}`;
    switch (f.type) {
      case 'text':
      case 'textarea': {
        const v = str(fd.get(key));
        if (v) data[f.name] = v;
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
        const raw = f.multi ? fd.getAll(key).map(str).filter(Boolean) : [str(fd.get(key))].filter(Boolean);
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
        if (spec.checklist) data.checklist = readChecklist(spec.checklist, fd);
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

/**
 * Required fields, file limits and the spec's customError rules. Returns field -> message.
 * fileCounts: number of files/signatures each file-like field will hold after the save.
 */
export function validateEntry(spec: FormSpec, data: EntryData, fileCounts: Record<string, number>): Record<string, string> {
  const errors: Record<string, string> = {};
  const ctx = {
    isEmpty: (name: string) => isEmptyValue(data[name]) && (fileCounts[name] ?? 0) === 0,
    fileCount: (name: string) => fileCounts[name] ?? 0,
  };
  for (const f of inputFields(spec)) {
    if (isRequired(f)) {
      const v = data[f.name];
      const missing = f.type === 'name' ? f.parts.some((p) => isEmptyValue((v as Record<string, unknown> | undefined)?.[p])) : isEmptyValue(v);
      if (missing) errors[f.name] = 'This field is required.';
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

/** Renders the entry summary template, e.g. "[QUOTENO]" or "[Name]" (name renders "First Last"). */
export function renderSummary(template: string, data: EntryData): string {
  return template
    .replace(/\[([A-Za-z_][A-Za-z0-9_]*)\]/g, (_, k: string) => displayValue(data[k]))
    .trim()
    .slice(0, 200);
}

/** Plain-text rendering of a stored value, for summaries, grids, exports, emails and PDFs. */
export function displayValue(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.map(displayValue).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('First' in o || 'Last' in o) return [o.First, o.Last].filter(Boolean).join(' ');
    return Object.values(o).map(displayValue).filter(Boolean).join(', ');
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

/** Initial values for a new entry: choice, email and date defaults from the spec. `today` is YYYY-MM-DD in the org timezone. */
export function defaultData(spec: FormSpec, opts: { today?: string } = {}): EntryData {
  const d: EntryData = {};
  for (const f of inputFields(spec)) {
    if ((f.type === 'choice' || f.type === 'email') && f.default) d[f.name] = f.type === 'choice' && f.multi ? [f.default] : f.default;
    if (f.type === 'date' && f.default === 'today' && opts.today) d[f.name] = opts.today;
  }
  return d;
}

/** Today's date (YYYY-MM-DD) in a timezone. */
export function todayIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
