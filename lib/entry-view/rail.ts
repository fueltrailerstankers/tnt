// Data for the entry page's rail cards: timeline, files, emails, generated PDFs and the Store Room shortfall. Pure.
import { cellId, minimumOf, present, shortBy } from '@/lib/spec/presentation';
import type { FormSpec } from '@/lib/spec/types';
import { inputFields } from '@/lib/spec/types';
import type { EntryData } from '@/lib/spec/values';
import { changedFieldNames, type EntryEventRow, type TimelineItem, type TimelineTone } from '@/lib/ui/timeline';
import { toneFor } from '@/lib/ui/status';

// --- timeline ---------------------------------------------------------------------------------------

/** Field key -> label, for the timeline's "changed fields". The checklist is stored under "checklist". */
export function fieldLabels(spec: FormSpec): Record<string, string> {
  const out: Record<string, string> = { checklist: 'Checklist' };
  for (const f of inputFields(spec)) if ('label' in f) out[f.name] = f.label.trim() || f.name;
  return out;
}

function toneOf(status: string | null): TimelineTone {
  if (!status) return 'neutral';
  const t = toneFor(status);
  return t === 'gray' ? 'neutral' : t;
}

/**
 * One Timeline item per entry_events row, newest first as given. Status moves read "MarkReviewed → Reviewed"
 * (the action and where it went); changed fields are listed by label. Only diff.changed (keys) is ever read:
 * any other diff property, and every value, is ignored.
 */
export function entryTimeline(
  rows: readonly EntryEventRow[],
  opts: { names?: Readonly<Record<string, string>>; labels?: Readonly<Record<string, string>> } = {},
): TimelineItem[] {
  const names = opts.names ?? {};
  return rows.map((row) => {
    const fields = changedFieldNames(row.diff, opts.labels);
    const moved = !!row.to_status && row.from_status !== row.to_status;
    const action = (row.action ?? '').trim() || 'Saved';
    const who = (row.actor_user && names[row.actor_user]) || (row.actor_role ?? '').trim() || 'Someone';
    return {
      id: String(row.id),
      who,
      what: moved ? `${action} → ${row.to_status}` : action,
      fields,
      at: row.created_at,
      tone: moved ? toneOf(row.to_status) : 'neutral',
    };
  });
}

// --- files ------------------------------------------------------------------------------------------

export interface FileRowInput {
  id: string;
  fieldKey: string;
  kind: 'file' | 'signature' | 'document';
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
}

export interface FileRow {
  id: string;
  name: string;
  /** "JPG", "PDF", "PNG"; "FILE" when unknown. */
  ext: string;
  /** "1.8 MB · Signatory ID" */
  meta: string;
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const TYPE_EXT: Record<string, string> = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WEBP', 'image/heic': 'HEIC', 'application/pdf': 'PDF' };

export function extOf(name: string, contentType: string | null): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  if (m) return m[1].toUpperCase().replace('JPEG', 'JPG');
  return (contentType && TYPE_EXT[contentType]) || 'FILE';
}

/** Files and signatures of the entry for the Files card, in field order, with the field's label. */
export function fileRows(spec: FormSpec, files: readonly FileRowInput[]): FileRow[] {
  const labels = fieldLabels(spec);
  const order = new Map(inputFields(spec).map((f, i) => [f.name, i]));
  return files
    .filter((f) => f.kind === 'file' || f.kind === 'signature')
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (order.get(a.f.fieldKey) ?? 1e6) - (order.get(b.f.fieldKey) ?? 1e6) || a.i - b.i)
    .map(({ f }) => ({
      id: f.id,
      name: f.fileName,
      ext: extOf(f.fileName, f.contentType),
      meta: [formatBytes(f.sizeBytes), f.kind === 'signature' ? `signature · ${labels[f.fieldKey] ?? f.fieldKey}` : labels[f.fieldKey] ?? f.fieldKey]
        .filter(Boolean)
        .join(' · '),
    }));
}

// --- generated PDFs ---------------------------------------------------------------------------------

export interface DocRowInput {
  id: string;
  template_number: number;
  name: string;
  sha256: string;
  created_at: string;
}

export interface PdfVersion {
  id: string;
  template: number;
  templateLabel: string;
  /** "v1", "v2"… per template, oldest first. */
  v: string;
  name: string;
  /** "c80d…5b19" */
  hash: string;
  at: string;
}

/** sha256 shown truncated: first four and last four hex characters. */
export function shortHash(sha: string | null | undefined): string {
  const h = String(sha ?? '').toLowerCase();
  if (!/^[0-9a-f]{8,}$/.test(h)) return '';
  return `${h.slice(0, 4)}…${h.slice(-4)}`;
}

/** Stored PDF versions, numbered v1, v2… per template (oldest = v1), returned newest first. */
export function pdfVersions(docs: readonly DocRowInput[], templates: ReadonlyArray<{ number: number; label: string }>): PdfVersion[] {
  const label = new Map(templates.map((t) => [t.number, t.label]));
  const sorted = [...docs].sort((a, b) => a.created_at.localeCompare(b.created_at) || String(a.id).localeCompare(String(b.id)));
  const seen = new Map<number, number>();
  const out = sorted.map((d) => {
    const n = (seen.get(d.template_number) ?? 0) + 1;
    seen.set(d.template_number, n);
    return {
      id: String(d.id), template: d.template_number, templateLabel: label.get(d.template_number) ?? `Document ${d.template_number}`,
      v: `v${n}`, name: d.name, hash: shortHash(d.sha256), at: d.created_at,
    };
  });
  return out.reverse();
}

// --- Store Room shortfall ---------------------------------------------------------------------------

export interface LowItem {
  name: string;
  label: string;
  value: number;
  min: number;
  short: number;
}

/** Count fields (Store Room) below the minimum written in their label, in form order. */
export function belowMinimum(spec: FormSpec, data: EntryData): LowItem[] {
  const out: LowItem[] = [];
  for (const step of present(spec)) {
    for (const sec of step.sections) {
      if (sec.kind !== 'count') continue;
      for (const row of sec.rows) {
        for (const c of row.cells) {
          const f = c.cell.field;
          if (f.type !== 'text') continue;
          const label = (c.label ?? f.label).trim() || f.name;
          const min = minimumOf(label);
          const raw = data[cellId(c.cell)];
          const v = typeof raw === 'string' || typeof raw === 'number' ? raw : null;
          const short = shortBy(v, min);
          if (short > 0 && min !== null) out.push({ name: f.name, label, value: Number(String(v).trim()), min, short });
        }
      }
    }
  }
  return out;
}
