// Cognito entry JSON -> what the importer writes for one entry. Pure: no I/O, no clock, no randomness.
//
// Values are keyed by Cognito FieldName exactly as the kit specs define them; nothing is invented. Keys the spec
// does not know are reported (names only), never stored. File and signature fields become download refs; the
// Delivery Note lookup becomes a reference to resolve through external_refs.
import { inputFields, type FormSpec } from '@/lib/spec/types';
import type { EntryData } from '@/lib/spec/values';
import { mapChecklist } from './checklist';
import type { CognitoEntry, CognitoFileRef } from './source';
import { isBlank, toChoice, toDate, toEmail, toNumber, toParts, toText, toTimestamp, type IssueCode } from './values';

export type SkipReason = 'missing_number' | 'missing_status' | 'unknown_status' | 'missing_timestamps';

export interface MappedFile {
  field: string;
  kind: 'file' | 'signature';
  /** Position within the field, as in Cognito. */
  index: number;
  /** Stable key for this file within the entry (Cognito file id, else URL, else position). */
  key: string;
  name: string;
  contentType: string | null;
  size: number | null;
  ref: CognitoFileRef;
}

export interface LookupRef {
  field: string;
  sourceSlug: string;
  /** Cognito entry id of the source entry, e.g. "4-123". */
  externalId: string;
}

export interface MappedEntry {
  externalId: string;
  number: number;
  status: string;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  /** Lookup fields are absent here; the importer adds them once resolved to our entry uuid. */
  data: EntryData;
  files: MappedFile[];
  signatures: MappedFile[];
  lookups: LookupRef[];
}

export interface FieldIssue {
  field: string;
  code: IssueCode;
}

export type MapResult =
  | { ok: true; entry: MappedEntry; unknownFields: string[]; unknownWithValue: string[]; issues: FieldIssue[] }
  | { ok: false; reason: SkipReason; externalId: string | null; unknownFields: string[]; unknownWithValue: string[]; issues: FieldIssue[] };

/**
 * Top-level keys that are entry metadata, not fields. ASSUMPTION (A4): Cognito puts the entry id in `Id`,
 * entry metadata (Number, Status, DateCreated, DateSubmitted, DateUpdated, links) in `Entry`, and form info in `Form`.
 */
export const META_KEYS = new Set(['Id', 'Entry', 'Form']);

const SAFE_KEY = /^[A-Za-z_$][A-Za-z0-9_.$]{0,80}$/;
/** Field names go into the report; anything that does not look like a field name is not echoed. */
export function reportableKey(k: string): string {
  return SAFE_KEY.test(k) ? k : '<unprintable-key>';
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function httpUrl(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === 'string' && /^https:\/\//i.test(v.trim())) return v.trim();
  return null;
}

/** Status name as the spec spells it. ASSUMPTION (A5): Entry.Status carries the workflow status name. */
export function mapStatus(spec: FormSpec, raw: unknown): { status: string } | { reason: SkipReason } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { reason: 'missing_status' };
  const hit = spec.workflow.statuses.find((x) => x.name.toLowerCase() === s.toLowerCase());
  return hit ? { status: hit.name } : { reason: 'unknown_status' };
}

/** Cognito entry reference in a lookup value -> "<formId>-<number>". ASSUMPTION (A12). */
export function lookupExternalId(v: unknown, sourceFormId: number | undefined): string | null {
  const o = obj(v);
  const raw = o ? (str(o.Id) ?? str(o.EntryId) ?? str(o.Number)) : str(v);
  if (!raw) return null;
  if (/^\d+-\d+$/.test(raw)) return raw;
  if (/^\d+$/.test(raw) && sourceFormId) return `${sourceFormId}-${Number(raw)}`;
  return null;
}

function fileRefs(field: string, v: unknown, issues: FieldIssue[]): MappedFile[] {
  if (isBlank(v)) return [];
  const list = Array.isArray(v) ? v : [v];
  const out: MappedFile[] = [];
  list.forEach((item, index) => {
    const o = obj(item);
    if (!o || isBlank(o)) return;
    const id = str(o.Id);
    const url = httpUrl(o.File, o.Url, o.DownloadUrl, o.Link);
    if (!id && !url) {
      issues.push({ field, code: 'file_without_source' });
      return;
    }
    const size = typeof o.Size === 'number' && o.Size >= 0 ? o.Size : null;
    out.push({
      field, kind: 'file', index, key: id ?? url ?? `#${index}`,
      name: str(o.Name) ?? 'file', contentType: str(o.ContentType), size, ref: { id, url, inline: null },
    });
  });
  return out;
}

/** ASSUMPTION (A7): a signature is an object with a PNG (URL or data URL) and/or SVG markup, or a file-like object. */
function signatureRef(field: string, v: unknown, issues: FieldIssue[]): MappedFile[] {
  const o = obj(Array.isArray(v) ? v[0] : v);
  if (!o || isBlank(o)) return [];
  const png = typeof o.Png === 'string' ? o.Png.trim() : '';
  const dataUrl = /^data:image\/png;base64,/i.exec(png) ? png : '';
  const url = httpUrl(o.Png, o.File, o.Url, o.Image);
  const id = str(o.Id);
  const base = { field, kind: 'signature' as const, index: 0, contentType: 'image/png' };
  if (dataUrl) {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return [{ ...base, key: 'inline-png', name: 'signature.png', size: Buffer.from(b64, 'base64').length, ref: { id: null, url: null, inline: { base64: b64, contentType: 'image/png' } } }];
  }
  if (url || id) {
    return [{ ...base, key: id ?? url ?? 'signature', name: 'signature.png', size: typeof o.Size === 'number' ? o.Size : null, ref: { id, url, inline: null } }];
  }
  if (typeof o.Svg === 'string' && o.Svg.trim()) {
    issues.push({ field, code: 'signature_svg_only' });
    const b = Buffer.from(o.Svg.trim(), 'utf8');
    return [{ ...base, key: 'inline-svg', name: 'signature.svg', contentType: 'image/svg+xml', size: b.length, ref: { id: null, url: null, inline: { base64: b.toString('base64'), contentType: 'image/svg+xml' } } }];
  }
  issues.push({ field, code: 'file_without_source' });
  return [];
}

export function mapEntry(spec: FormSpec, raw: CognitoEntry): MapResult {
  const issues: FieldIssue[] = [];
  const unknownFields: string[] = [];
  const unknownWithValue: string[] = [];
  const meta = obj(raw.Entry) ?? {};
  const data: EntryData = {};
  const files: MappedFile[] = [];
  const signatures: MappedFile[] = [];
  const lookups: LookupRef[] = [];
  const known = new Set<string>(META_KEYS);
  const tablePrefixes: string[] = [];

  for (const f of inputFields(spec)) {
    known.add(f.name);
    const v = raw[f.name];
    const note = (code: IssueCode | undefined) => code && issues.push({ field: f.name, code });
    switch (f.type) {
      case 'text':
      case 'textarea': {
        const r = toText(v);
        note(r.issue);
        if (r.value !== undefined) data[f.name] = r.value;
        break;
      }
      case 'email': {
        const r = toEmail(v);
        note(r.issue);
        if (r.value !== undefined) data[f.name] = r.value;
        break;
      }
      case 'date': {
        const r = toDate(v);
        note(r.issue);
        if (r.value !== undefined) data[f.name] = r.value;
        break;
      }
      case 'number': {
        const r = toNumber(v, f.integer);
        note(r.issue);
        if (r.value !== undefined) data[f.name] = r.value;
        break;
      }
      case 'choice': {
        const r = toChoice(v, f.options, f.multi);
        note(r.issue);
        if (r.value !== undefined) data[f.name] = r.value;
        break;
      }
      case 'name':
      case 'address': {
        const r = toParts(v, f.parts, f.type);
        note(r.issue);
        if (r.value !== undefined) data[f.name] = r.value;
        for (const d of r.dropped) unknownWithValue.push(`${f.name}.${reportableKey(d)}`);
        break;
      }
      case 'lookup': {
        if (isBlank(v)) break;
        const ext = lookupExternalId(v, f.lookup.cognitoSourceFormId);
        if (ext) lookups.push({ field: f.name, sourceSlug: f.lookup.sourceForm, externalId: ext });
        else note('invalid_value');
        break;
      }
      case 'file':
        files.push(...fileRefs(f.name, v, issues));
        break;
      case 'signature':
        signatures.push(...signatureRef(f.name, v, issues));
        break;
      case 'section':
        break; // handled with spec.checklist below
      case 'table':
        // Delivery Note: a read-only panel; Cognito's own key is recorded (abbreviated) in cognitoFieldName.
        if (f.cognitoFieldName) tablePrefixes.push(f.cognitoFieldName.split('...')[0]);
        break;
    }
  }

  const section = inputFields(spec).find((f) => f.type === 'section');
  if (section && spec.checklist) {
    const cl = mapChecklist(raw, spec.checklist, section.name, known);
    data.checklist = cl.rows;
    cl.consumedKeys.forEach((k) => known.add(k));
    cl.issues.forEach((code) => issues.push({ field: 'checklist', code }));
    cl.dropped.forEach((d) => unknownWithValue.push(reportableKey(d)));
  }

  for (const k of Object.keys(raw)) {
    if (known.has(k) || k.startsWith('$') || k.startsWith('@')) continue;
    if (tablePrefixes.some((p) => p && k.startsWith(p))) continue;
    unknownFields.push(reportableKey(k));
    if (!isBlank(raw[k])) unknownWithValue.push(reportableKey(k));
  }

  const number = typeof meta.Number === 'number' ? meta.Number : typeof meta.Number === 'string' ? Number(meta.Number) : NaN;
  const idRaw = str(raw.Id);
  const externalId = idRaw ?? (Number.isInteger(number) && number > 0 ? `${spec.cognitoFormId}-${number}` : null);
  const base = { unknownFields, unknownWithValue, issues };
  if (!Number.isInteger(number) || number < 1 || !externalId) return { ok: false, reason: 'missing_number', externalId, ...base };
  const st = mapStatus(spec, meta.Status);
  if ('reason' in st) return { ok: false, reason: st.reason, externalId, ...base };

  const submitted = toTimestamp(meta.DateSubmitted) ?? null;
  const created = toTimestamp(meta.DateCreated) ?? submitted ?? toTimestamp(meta.DateUpdated);
  if (!created) return { ok: false, reason: 'missing_timestamps', externalId, ...base };
  const updated = toTimestamp(meta.DateUpdated) ?? submitted ?? created;

  return {
    ok: true,
    entry: { externalId, number, status: st.status, created_at: created, updated_at: updated, submitted_at: submitted, data, files, signatures, lookups },
    ...base,
  };
}
