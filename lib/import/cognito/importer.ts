// Cognito history import: reads entries through a CognitoSource, maps them (map.ts) and writes them through an
// ImportSink. Dry-run writes nothing. Apply is idempotent and resumable:
//
//   1. entries row (original Entry.Number, so the numbering trigger leaves it alone; cognito_entry_id set)
//   2. each file/signature: deterministic storage path, upload (upsert), entry_files row  (skipped if the row exists)
//   3. entry_events "Import" row                                                          (skipped if it exists)
//   4. external_refs row (source cognito, entity entry:<slug>)  <- the commit marker, written last
//
// A crash anywhere before 4 leaves an entry with cognito_entry_id but no ref; the next run finds it by
// cognito_entry_id and finishes steps 2-4 without inserting anything twice. An entry with a ref is skipped.
// After each form, form_counters.last_number is set to the highest entry number (never lowered).
import { createHash, randomUUID } from 'node:crypto';
import type { FormRecord } from '@/lib/forms/forms';
import { displayFileName, safeObjectName, sniff, storedContentType } from '@/lib/security/files';
import { MAX_FILE_BYTES, renderSummary, type EntryData } from '@/lib/spec/values';
import { mapEntry, type MappedEntry, type MappedFile } from './map';
import { bump, emptyFormReport, type FailReason, type FormReport, type ImportReport } from './report';
import { refEntity, type EntryKey, type ImportSink } from './sink';
import { decodeInline, type CognitoSource } from './source';

/** RFI before Delivery Note: the Delivery Note lookup resolves to RFI entries through external_refs. */
export const IMPORT_ORDER = [
  'request-for-invoice', 'deal', 'job-card', 'trailer-inspection-checklist', 'release-form', 'delivery-note', 'store-room',
] as const;

/** Same contract as lib/forms/entries.ts sealData (the script passes sealData itself). */
export type Sealer = (form: FormRecord, entryId: string, data: EntryData) => { data: EntryData; data_encrypted: string | null };

export interface ImportOptions {
  forms: string[];
  apply: boolean;
  /** Import at most this many new entries per form. */
  limit?: number;
  /** Only entries created on or after this instant (Entry.DateCreated). */
  since?: Date;
  /** Import a Delivery Note whose RFI is not imported, leaving its lookup empty. Default: skip it. */
  allowUnresolvedLookups?: boolean;
  /** Entries written in parallel (apply). */
  concurrency?: number;
  /** Entry id generator; tests make it deterministic. */
  newId?: () => string;
}

export interface ImportDeps {
  source: CognitoSource;
  sink: ImportSink;
  seal: Sealer;
}

export function orderForms(slugs: string[]): string[] {
  const order: readonly string[] = IMPORT_ORDER;
  return [...slugs].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
}

/** UUID-shaped, derived from the input, so a re-run writes the same storage path. */
export function stableUuid(input: string): string {
  const h = createHash('sha256').update(input).digest('hex');
  const v = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Standard path shape <form>/<entry-id>/<field>/<uuid>-<name> (lib/forms/storage.ts finalPath), deterministic. */
export function importObjectPath(slug: string, entryId: string, externalId: string, f: MappedFile): string {
  return `${slug}/${entryId}/${f.field}/${stableUuid(`cognito|${externalId}|${f.field}|${f.index}|${f.key}`)}-${safeObjectName(f.name)}`;
}

class Failure extends Error {
  constructor(readonly reason: FailReason) {
    super(reason);
  }
}

async function stage<T>(reason: FailReason, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Failure) throw e;
    throw new Failure(reason);
  }
}

interface Ctx {
  deps: ImportDeps;
  form: FormRecord;
  report: FormReport;
}

async function importOne(ctx: Ctx, m: MappedEntry, data: EntryData, existing: EntryKey | undefined, newId: () => string): Promise<string> {
  const { sink, source, seal } = ctx.deps;
  const { form, report } = ctx;
  const id = existing?.id ?? newId();

  if (!existing) {
    const sealed = seal(form, id, data);
    await stage('write_failed', () => sink.insertEntry({
      id, form_id: form.id, number: m.number, status: m.status, ...sealed,
      summary: renderSummary(form.summaryTemplate, data) || null,
      created_at: m.created_at, updated_at: m.updated_at, submitted_at: m.submitted_at, cognito_entry_id: m.externalId,
    }));
  }

  const have = new Set(await stage('write_failed', () => sink.listFilePaths(id)));
  const all = [...m.files, ...m.signatures];
  for (const [i, f] of all.entries()) {
    const path = importObjectPath(form.slug, id, m.externalId, f);
    if (have.has(path)) continue;
    const dl = await stage('download_failed', async () => decodeInline(f.ref) ?? (await source.downloadFile(f.ref)));
    if (!dl.bytes.length) throw new Failure('download_failed');
    if (dl.bytes.length > MAX_FILE_BYTES) throw new Failure('file_too_large');
    const sniffed = sniff(dl.bytes.subarray(0, 16));
    const declared = f.contentType ?? dl.contentType ?? '';
    const contentType = sniffed ? storedContentType(sniffed, declared) : declared || 'application/octet-stream';
    if (!sniffed) bump(report.issues, `${f.field}:file_type_unrecognised`);
    await stage('upload_failed', () => sink.upload(path, dl.bytes, contentType));
    const ext = f.contentType === 'image/svg+xml' ? 'svg' : 'png';
    await stage('write_failed', () => sink.insertFile({
      entry_id: id, field_key: f.field, kind: f.kind, storage_path: path,
      file_name: f.kind === 'signature' ? `${f.field}.${ext}` : displayFileName(f.name),
      content_type: contentType, size_bytes: dl.bytes.length, sort_order: i + 1,
    }));
    report.stored.files++;
    report.stored.bytes += dl.bytes.length;
  }

  if (!(await stage('write_failed', () => sink.hasImportEvent(id)))) {
    const changed = [...new Set([...Object.keys(data), ...all.map((f) => f.field)])].sort();
    await stage('write_failed', () => sink.insertEvent({
      entry_id: id, action: 'Import', from_status: null, to_status: m.status, actor_user: null, actor_role: 'Import',
      diff: { changed, source: 'cognito' },
    }));
  }
  await stage('write_failed', () => sink.insertRef(refEntity(form.slug), m.externalId, id));
  return id;
}

export async function runImport(deps: ImportDeps, opts: ImportOptions): Promise<ImportReport> {
  const { sink, source } = deps;
  const newId = opts.newId ?? randomUUID;
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const report: ImportReport = { mode: opts.apply ? 'apply' : 'dry-run', forms: [], notes: [] };
  const forms = new Map((await sink.loadForms()).map((f) => [f.slug, f]));
  const refs = new Map<string, Map<string, string>>();
  const planned = new Map<string, Set<string>>();
  const refsOf = async (slug: string) => {
    if (!refs.has(slug)) refs.set(slug, await sink.loadRefs(refEntity(slug)));
    return refs.get(slug)!;
  };

  for (const slug of orderForms(opts.forms)) {
    const form = forms.get(slug);
    if (!form) {
      report.notes.push(`form ${slug} is not in the platform; nothing read`);
      continue;
    }
    const fr = emptyFormReport(slug, form.spec.entryCountAtExport);
    report.forms.push(fr);
    const ctx: Ctx = { deps, form, report: fr };
    const done = await refsOf(slug);
    const plan = new Set<string>();
    planned.set(slug, plan);
    const keys = await sink.listEntryKeys(form.id);
    const byCognito = new Map(keys.filter((k) => k.cognito_entry_id).map((k) => [k.cognito_entry_id!, k]));
    const byNumber = new Map(keys.map((k) => [k.number, k]));
    let maxSeen = 0;
    const running = new Set<Promise<void>>();

    for await (const raw of source.listEntries({ slug, cognitoFormId: form.spec.cognitoFormId, internalName: form.spec.internalName }, { since: opts.since })) {
      fr.seen++;
      const r = mapEntry(form.spec, raw);
      for (const k of r.unknownFields) (fr.unknownFields[k] ??= { present: 0, withValue: 0 }).present++;
      for (const k of r.unknownWithValue) (fr.unknownFields[k] ??= { present: 0, withValue: 0 }).withValue++;
      for (const i of r.issues) bump(fr.issues, `${i.field}:${i.code}`);
      if (!r.ok) {
        bump(fr.skipped, r.reason);
        continue;
      }
      const m = r.entry;
      maxSeen = Math.max(maxSeen, m.number);
      if (done.has(m.externalId)) {
        fr.alreadyImported++;
        continue;
      }
      if (opts.since && new Date(m.created_at) < opts.since) {
        bump(fr.skipped, 'before_since');
        continue;
      }
      const existing = byCognito.get(m.externalId);
      const clash = byNumber.get(m.number);
      if (!existing && clash) {
        bump(fr.failed, 'number_taken');
        continue;
      }

      const data: EntryData = { ...m.data };
      let lookupOk = true;
      for (const l of m.lookups) {
        const internal = (await refsOf(l.sourceSlug)).get(l.externalId);
        if (internal) {
          data[l.field] = internal;
          fr.lookups.resolved++;
        } else if (!opts.apply && planned.get(l.sourceSlug)?.has(l.externalId)) {
          fr.lookups.pendingSource++;
        } else {
          fr.lookups.unresolved++;
          if (!opts.allowUnresolvedLookups) lookupOk = false;
        }
      }
      if (!lookupOk) {
        bump(fr.skipped, 'lookup_unresolved');
        continue;
      }

      if (opts.limit !== undefined && fr.toImport >= opts.limit) {
        fr.stoppedAtLimit = true;
        break;
      }
      fr.toImport++;
      if (existing) fr.resumable++;
      plan.add(m.externalId);
      for (const f of m.files) {
        fr.files.count++;
        if (f.size === null) fr.files.unknownSize++;
        else fr.files.bytes += f.size;
      }
      for (const s of m.signatures) {
        fr.signatures.count++;
        if (s.size === null) fr.signatures.unknownSize++;
        else fr.signatures.bytes += s.size;
      }
      if (!opts.apply) continue;

      const task = importOne(ctx, m, data, existing, newId)
        .then((id) => {
          fr.imported++;
          done.set(m.externalId, id);
        })
        .catch((e: unknown) => bump(fr.failed, e instanceof Failure ? e.reason : 'write_failed'))
        .finally(() => running.delete(task));
      running.add(task);
      if (running.size >= concurrency) await Promise.race(running);
    }
    await Promise.all(running);

    fr.maxNumber = maxSeen || null;
    if (opts.apply) {
      const max = await sink.maxNumber(form.id);
      const current = await sink.getCounter(form.id);
      const target = Math.max(max, current ?? 0);
      if (target !== current) await sink.setCounter(form.id, target);
      fr.counterSetTo = target;
    }
  }

  if (!opts.apply) report.notes.push('dry-run: nothing was written. Run again with --apply to import.');
  return report;
}
