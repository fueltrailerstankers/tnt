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
import { displayFileName, safeObjectName, safeSignatureSvg, sniff, storedContentType } from '@/lib/security/files';
import { MAX_FILE_BYTES, renderSummary, type EntryData } from '@/lib/spec/values';
import { mapEntry, type MappedEntry, type MappedFile } from './map';
import { bump, emptyFormReport, type FailReason, type FormReport, type ImportReport } from './report';
import { refEntity, type EntryKey, type ImportSink } from './sink';
import { decodeInline, type CognitoEntry, type CognitoFormRef, type CognitoSource, type ListOptions, type PositionedEntry, type SourcePosition } from './source';

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
    // Unrecognised bytes are kept but never served with a type Cognito declared (e.g. text/html, image/svg+xml).
    // The one exception: an inline SVG-only signature (A7) whose markup passes safeSignatureSvg, so it renders in <img>.
    const svg = !sniffed && f.kind === 'signature' && f.ref.inline?.contentType === 'image/svg+xml' && safeSignatureSvg(dl.bytes);
    const contentType = sniffed ? storedContentType(sniffed, declared) : svg ? 'image/svg+xml' : 'application/octet-stream';
    if (!sniffed && !svg) bump(report.issues, `${f.field}:file_type_unrecognised`);
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

/** Lookup source ids planned by a dry run of another form (lets a Delivery Note dry run count RFIs not imported yet). */
export type PlannedSources = Map<string, Set<string>>;

/** Optional controls for a resumable, time-boxed read of one form (the in-app job; the CLI does not use them). */
export interface SliceControl {
  /** Where an earlier slice of the same run stopped; omitted or null = from the start. */
  from?: SourcePosition | null;
  /** Stop reading new entries at this time (ms since epoch). Entries in flight finish first. */
  deadline?: number;
  /** Polled at each checkpoint; true pauses the read there. */
  shouldStop?: () => Promise<boolean>;
  /**
   * Called with a consistent state: every entry before `position` is fully processed (written or counted) and the
   * report reflects it. The job saves the report and position here, so a crash loses at most one checkpoint.
   * `planned` is the entry ids this slice has planned so far (see SliceResult.planned).
   */
  checkpoint?: (position: SourcePosition | null, planned: string[]) => Promise<void>;
  /** Checkpoint after this many steps (entries or misses). Default 25. */
  checkpointEvery?: number;
  /** ... or after this many ms. Default 3000. */
  checkpointMs?: number;
}

export type FormOutcome = 'done' | 'limit' | 'budget' | 'stopped';

interface RunEnv {
  deps: ImportDeps;
  opts: ImportOptions;
  newId: () => string;
  concurrency: number;
  refsOf: (slug: string) => Promise<Map<string, string>>;
  planned: PlannedSources;
}

/**
 * Resumable read: the source's own positions when it has listPositioned, else entries are counted and a resume
 * re-reads and skips the ones already handled (correct for any source that lists in a stable order).
 */
async function* positioned(source: CognitoSource, ref: CognitoFormRef, opts: ListOptions, from: SourcePosition | null): AsyncIterable<PositionedEntry> {
  if (source.listPositioned) {
    yield* source.listPositioned(ref, { ...opts, from });
    return;
  }
  const skip = from?.kind === 'index' ? from.n : 0;
  let i = 0;
  for await (const entry of source.listEntries(ref, opts)) {
    i++;
    if (i <= skip) continue;
    yield { entry, position: { kind: 'index', n: i } };
  }
}

/** Reads one form (all of it, or one slice with `control`) into `fr`. Counters are set only when the form is finished. */
async function importForm(env: RunEnv, form: FormRecord, fr: FormReport, control?: SliceControl): Promise<{ outcome: FormOutcome; position: SourcePosition | null }> {
  const { deps, opts, newId, concurrency } = env;
  const { sink, source } = deps;
  const slug = form.slug;
  const ctx: Ctx = { deps, form, report: fr };
  const done = await env.refsOf(slug);
  const plan = env.planned.get(slug) ?? new Set<string>();
  env.planned.set(slug, plan);
  const keys = await sink.listEntryKeys(form.id);
  const byCognito = new Map(keys.filter((k) => k.cognito_entry_id).map((k) => [k.cognito_entry_id!, k]));
  const byNumber = new Map(keys.map((k) => [k.number, k]));
  const running = new Set<Promise<void>>();

  /** One Cognito entry: counted, and in apply mode written (in parallel, up to `concurrency`). */
  const handle = async (raw: CognitoEntry): Promise<'next' | 'limit'> => {
    fr.seen++;
    const r = mapEntry(form.spec, raw);
    for (const k of r.unknownFields) (fr.unknownFields[k] ??= { present: 0, withValue: 0 }).present++;
    for (const k of r.unknownWithValue) (fr.unknownFields[k] ??= { present: 0, withValue: 0 }).withValue++;
    for (const i of r.issues) bump(fr.issues, `${i.field}:${i.code}`);
    if (!r.ok) {
      bump(fr.skipped, r.reason);
      return 'next';
    }
    const m = r.entry;
    fr.maxNumber = Math.max(fr.maxNumber ?? 0, m.number) || null;
    if (done.has(m.externalId)) {
      fr.alreadyImported++;
      return 'next';
    }
    if (opts.since && new Date(m.created_at) < opts.since) {
      bump(fr.skipped, 'before_since');
      return 'next';
    }
    const existing = byCognito.get(m.externalId);
    const clash = byNumber.get(m.number);
    if (!existing && clash) {
      bump(fr.failed, 'number_taken');
      return 'next';
    }

    const data: EntryData = { ...m.data };
    let lookupOk = true;
    for (const l of m.lookups) {
      const internal = (await env.refsOf(l.sourceSlug)).get(l.externalId);
      if (internal) {
        data[l.field] = internal;
        fr.lookups.resolved++;
      } else if (!opts.apply && env.planned.get(l.sourceSlug)?.has(l.externalId)) {
        fr.lookups.pendingSource++;
      } else {
        fr.lookups.unresolved++;
        if (!opts.allowUnresolvedLookups) lookupOk = false;
      }
    }
    if (!lookupOk) {
      bump(fr.skipped, 'lookup_unresolved');
      return 'next';
    }

    if (opts.limit !== undefined && fr.toImport >= opts.limit) {
      fr.stoppedAtLimit = true;
      return 'limit';
    }
    fr.toImport++;
    if (existing) fr.resumable++;
    plan.add(m.externalId);
    for (const f of m.files) {
      fr.files.count++;
      if (f.size === null) fr.files.unknownSize++;
      else fr.files.bytes += f.size;
    }
    for (const sg of m.signatures) {
      fr.signatures.count++;
      if (sg.size === null) fr.signatures.unknownSize++;
      else fr.signatures.bytes += sg.size;
    }
    if (!opts.apply) return 'next';

    const task = importOne(ctx, m, data, existing, newId)
      .then((id) => {
        fr.imported++;
        done.set(m.externalId, id);
      })
      .catch((e: unknown) => bump(fr.failed, e instanceof Failure ? e.reason : 'write_failed'))
      .finally(() => running.delete(task));
    running.add(task);
    if (running.size >= concurrency) await Promise.race(running);
    return 'next';
  };

  const ref = { slug, cognitoFormId: form.spec.cognitoFormId, internalName: form.spec.internalName };
  let position = control?.from ?? null;
  let outcome: FormOutcome = 'done';
  const every = control?.checkpointEvery ?? 25;
  const everyMs = control?.checkpointMs ?? 3000;
  let steps = 0;
  let lastCheckpoint = Date.now();
  try {
    for await (const step of positioned(source, ref, { since: opts.since }, position)) {
      if (step.entry && (await handle(step.entry)) === 'limit') {
        outcome = 'limit';
        break;
      }
      position = step.position;
      if (!control) continue;
      const timeUp = control.deadline !== undefined && Date.now() >= control.deadline;
      if (!timeUp && ++steps < every && Date.now() - lastCheckpoint < everyMs) continue;
      await Promise.all(running);
      await control.checkpoint?.(position, [...plan]);
      steps = 0;
      lastCheckpoint = Date.now();
      if (timeUp) {
        outcome = 'budget';
        break;
      }
      if (await control.shouldStop?.()) {
        outcome = 'stopped';
        break;
      }
    }
  } finally {
    // Never leave writes running behind a thrown read error.
    await Promise.all(running);
  }

  if (opts.apply && (outcome === 'done' || outcome === 'limit')) {
    const max = await sink.maxNumber(form.id);
    const current = await sink.getCounter(form.id);
    const target = Math.max(max, current ?? 0);
    if (target !== current) await sink.setCounter(form.id, target);
    fr.counterSetTo = target;
  }
  return { outcome, position: outcome === 'budget' || outcome === 'stopped' ? position : null };
}

function runEnv(deps: ImportDeps, opts: ImportOptions, planned: PlannedSources = new Map()): RunEnv {
  const refs = new Map<string, Map<string, string>>();
  return {
    deps, opts, planned,
    newId: opts.newId ?? randomUUID,
    concurrency: Math.max(1, opts.concurrency ?? 4),
    refsOf: async (slug: string) => {
      if (!refs.has(slug)) refs.set(slug, await deps.sink.loadRefs(refEntity(slug)));
      return refs.get(slug)!;
    },
  };
}

export async function runImport(deps: ImportDeps, opts: ImportOptions): Promise<ImportReport> {
  const report: ImportReport = { mode: opts.apply ? 'apply' : 'dry-run', forms: [], notes: [] };
  const forms = new Map((await deps.sink.loadForms()).map((f) => [f.slug, f]));
  const env = runEnv(deps, opts);

  for (const slug of orderForms(opts.forms)) {
    const form = forms.get(slug);
    if (!form) {
      report.notes.push(`form ${slug} is not in the platform; nothing read`);
      continue;
    }
    const fr = emptyFormReport(slug, form.spec.entryCountAtExport);
    report.forms.push(fr);
    await importForm(env, form, fr);
  }

  if (!opts.apply) report.notes.push('dry-run: nothing was written. Run again with --apply to import.');
  return report;
}

export interface SliceOptions extends Omit<ImportOptions, 'forms'>, SliceControl {
  form: string;
  /** The report so far (from earlier slices of the same run); omitted = a fresh report. Mutated and returned. */
  report?: FormReport | null;
  /** Dry runs: lookup source ids another form's dry run planned in the same batch. */
  planned?: PlannedSources;
}

export interface SliceResult {
  report: FormReport;
  /** done/limit: the form is finished. budget/stopped: resume from `position` with the returned report. */
  outcome: FormOutcome;
  position: SourcePosition | null;
  /** Entry ids this form's read planned to import (this slice only); a dry run passes them on to lookup forms. */
  planned: string[];
}

/** One time-boxed, resumable part of a one-form run (the in-app 'cognito.import' job). Throws if the form is not in the platform. */
export async function runImportSlice(deps: ImportDeps, opts: SliceOptions): Promise<SliceResult> {
  const form = (await deps.sink.loadForms()).find((f) => f.slug === opts.form);
  if (!form) throw new Error('form not in the platform');
  const planned: PlannedSources = new Map(opts.planned ?? []);
  planned.set(form.slug, new Set());
  const env = runEnv(deps, { ...opts, forms: [form.slug] }, planned);
  const fr = opts.report ?? emptyFormReport(form.slug, form.spec.entryCountAtExport);
  const r = await importForm(env, form, fr, opts);
  return { report: fr, outcome: r.outcome, position: r.position, planned: [...(planned.get(form.slug) ?? [])] };
}
