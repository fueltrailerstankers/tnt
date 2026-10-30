import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { sealData } from '@/lib/forms/entries';
import { loadForms, type FormRecord } from '@/lib/forms/forms';
import { drain, enqueue, recordRun, releaseStuck, type Job } from '@/lib/jobs/outbox';
import { parseKey } from '@/lib/security/crypto';
import type { Member } from '@/lib/security/can';
import { COGNITO_API_BASE, HttpCognitoSource } from './api';
import { orderForms, runImportSlice, type PlannedSources } from './importer';
import { apiKeyInfo, loadApiKey } from './key';
import {
  errorCode, IMPORT_QUEUE, ImportJobError, lookupSources, matchForms, mergePlanned, parseCursor, parseOptions, parseReport,
  type FormMatch, type PlatformFormRef, type RunMode, type RunStatus,
} from './progress';
import { emptyFormReport } from './report';
import { SupabaseSink } from './supabase-sink';

// In-app Cognito import (docs/M5.md "Import from the app"). The admin page creates import_runs rows (one per form;
// "All forms" makes a batch worked through in import order) and enqueues the outbox job 'cognito.import'
// ({ run_id }). Each job runs ONE time-boxed slice of the importer for that run:
//
//   claim the run (lease) -> read from the saved cursor until the deadline -> checkpoint report + cursor every few
//   seconds -> budget left over: save, release the lease, enqueue the next slice -> form finished: done, then the
//   next form of the batch; an apply also enqueues 'deal-files.rebuild'.
//
// Everything the importer writes is idempotent (docs/M5.md), so a slice that dies mid-way is simply re-run from
// its last checkpoint (the outbox re-queues a job stuck in 'running' after 10 minutes). Only one slice works on a
// run at a time (lease_until); only one queued/running run per form exists (unique index). The Cognito key is
// decrypted here only; errors are stored as reason codes, never messages.

/** Longest slice. The jobs route allows 60 s; the margin covers entries in flight and the final save. */
export const SLICE_MS = 40_000;
/** Less time than this left in a drain: hand the run to the next drain instead of starting a slice. */
const MIN_SLICE_MS = 8_000;
/** A lease outlives the slice deadline by this much, so a dead slice frees the run soon after. */
const LEASE_MARGIN_MS = 30_000;

const RUN_COLS = 'id, org_id, form_slug, mode, status, batch_id, seq, options, cursor, report, error, stop_requested, lease_until, started_by, created_at, started_at, updated_at, finished_at';

export interface ImportRun {
  id: string;
  org_id: string;
  form_slug: string;
  mode: RunMode;
  status: RunStatus;
  batch_id: string | null;
  seq: number;
  options: unknown;
  cursor: unknown;
  report: unknown;
  error: string | null;
  stop_requested: boolean;
  lease_until: string | null;
  started_by: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  finished_at: string | null;
}

export const RUN_SELECT = RUN_COLS;

/** The Cognito API client used in the app. COGNITO_API_URL overrides the base (tests point it at a mock). */
export function cognitoSource(apiKey: string): HttpCognitoSource {
  const base = process.env.COGNITO_API_URL?.trim() || COGNITO_API_BASE;
  return new HttpCognitoSource({ apiKey, baseUrl: base, listMode: 'by-number' });
}

/** Platform forms that can be imported (they carry a Cognito form id), in import order. */
export async function importableForms(db: SupabaseClient, orgId: string): Promise<FormRecord[]> {
  const forms = (await loadForms(db, orgId)).filter((f) => Number.isInteger(f.spec.cognitoFormId) && f.spec.cognitoFormId > 0);
  const order = orderForms(forms.map((f) => f.slug));
  return order.map((slug) => forms.find((f) => f.slug === slug)!);
}

const platformRef = (f: FormRecord): PlatformFormRef => ({ slug: f.slug, name: f.name, cognitoFormId: f.spec.cognitoFormId, expected: f.spec.entryCountAtExport });

// ---------------------------------------------------------------------------------------------------------------
// Test connection
// ---------------------------------------------------------------------------------------------------------------
export type ConnectionResult =
  | { ok: true; forms: FormMatch[]; missing: PlatformFormRef[]; entryAccess: 'ok' | 'denied' | null }
  | { ok: false; error: string };

export async function testConnection(db: SupabaseClient, orgId: string): Promise<ConnectionResult> {
  try {
    const apiKey = await loadApiKey(db, orgId);
    if (!apiKey) return { ok: false, error: 'no_api_key' };
    const source = cognitoSource(apiKey);
    const cognito = await source.listForms();
    const platform = await importableForms(db, orgId);
    const { forms, missing } = matchForms(cognito, platform.map(platformRef));
    const first = forms.find((f) => f.platform)?.platform;
    const entryAccess = first ? await source.probeEntries({ slug: first.slug, cognitoFormId: first.cognitoFormId, internalName: '' }) : null;
    return { ok: true, forms, missing, entryAccess };
  } catch (e) {
    return { ok: false, error: errorCode(e) };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Start / stop / resume (called by the server actions after requirePerm('import.run'); db is the service role)
// ---------------------------------------------------------------------------------------------------------------
export type ActionResult = { ok: true; runIds: string[] } | { ok: false; error: string };

const isUniqueViolation = (e: { code?: string } | null) => e?.code === '23505';
/** PostgREST filter: no slice holds the run (no lease, or it ran out). The timestamp is quoted (it holds ':' and '.'). */
const leaseFree = (iso: string) => `lease_until.is.null,lease_until.lt."${iso}"`;

export async function startImport(db: SupabaseClient, member: Member, input: { form: string; mode: RunMode; limit?: number }): Promise<ActionResult> {
  if (!(await apiKeyInfo(db, member.orgId))) return { ok: false, error: 'Save a Cognito API key first.' };
  const forms = await importableForms(db, member.orgId);
  const chosen = input.form === 'all' ? forms : forms.filter((f) => f.slug === input.form);
  if (!chosen.length) return { ok: false, error: 'That form cannot be imported.' };
  if (input.mode === 'apply' && chosen.some((f) => f.encrypt)) {
    try {
      parseKey(process.env.ENTRY_ENCRYPTION_KEY, 'ENTRY_ENCRYPTION_KEY');
    } catch {
      return { ok: false, error: 'ENTRY_ENCRYPTION_KEY is not set on the server; DEAL and Delivery Note entries cannot be imported.' };
    }
  }
  const batchId = chosen.length > 1 ? randomUUID() : null;
  const rows = chosen.map((f, i) => ({
    org_id: member.orgId, form_slug: f.slug, mode: input.mode, status: 'queued', batch_id: batchId, seq: i + 1,
    options: input.limit ? { limit: input.limit } : {}, started_by: member.userId,
  }));
  const { data, error } = await db.from('import_runs').insert(rows).select('id, seq');
  if (isUniqueViolation(error)) return { ok: false, error: 'An import for this form is already queued or running. Wait for it, or stop it first.' };
  if (error || !data?.length) throw new Error('Could not create the import run');
  const ids = (data as Array<{ id: string; seq: number }>).sort((a, b) => a.seq - b.seq).map((r) => r.id);
  await enqueue(db, member.orgId, IMPORT_QUEUE, { run_id: ids[0] });
  return { ok: true, runIds: ids };
}

async function loadRun(db: SupabaseClient, orgId: string, runId: string): Promise<ImportRun | null> {
  const { data, error } = await db.from('import_runs').select(RUN_COLS).eq('org_id', orgId).eq('id', runId).maybeSingle();
  if (error) throw new Error('import_runs read failed');
  return (data as ImportRun | null) ?? null;
}

/** Runs a stop/resume applies to: the whole batch for "All forms", else the run itself. */
async function batchOf(db: SupabaseClient, run: ImportRun): Promise<ImportRun[]> {
  if (!run.batch_id) return [run];
  const { data, error } = await db.from('import_runs').select(RUN_COLS).eq('org_id', run.org_id).eq('batch_id', run.batch_id).order('seq');
  if (error) throw new Error('import_runs read failed');
  return (data ?? []) as ImportRun[];
}

/**
 * Stop: queued runs pause at once; a running slice is asked to stop (it pauses at its next checkpoint, within a few
 * seconds); a run waiting between slices pauses at once.
 */
export async function stopImport(db: SupabaseClient, orgId: string, runId: string): Promise<ActionResult> {
  const run = await loadRun(db, orgId, runId);
  if (!run) return { ok: false, error: 'Run not found.' };
  const ids = (await batchOf(db, run)).filter((r) => r.status === 'queued' || r.status === 'running').map((r) => r.id);
  if (!ids.length) return { ok: false, error: 'This run is not queued or running.' };
  const now = new Date().toISOString();
  const q1 = await db.from('import_runs').update({ status: 'paused' }).eq('org_id', orgId).in('id', ids).eq('status', 'queued');
  const q2 = await db.from('import_runs').update({ status: 'paused', stop_requested: false }).eq('org_id', orgId).in('id', ids).eq('status', 'running')
    .or(leaseFree(now));
  const q3 = await db.from('import_runs').update({ stop_requested: true }).eq('org_id', orgId).in('id', ids).eq('status', 'running').gte('lease_until', now);
  if (q1.error || q2.error || q3.error) throw new Error('import_runs update failed');
  return { ok: true, runIds: ids };
}

/** Resume a paused or failed run (and the paused/failed rest of its batch) from where it stopped. */
export async function resumeImport(db: SupabaseClient, member: Member, runId: string): Promise<ActionResult> {
  const run = await loadRun(db, member.orgId, runId);
  if (!run) return { ok: false, error: 'Run not found.' };
  if (run.status !== 'paused' && run.status !== 'failed') return { ok: false, error: 'Only a paused or failed run can be resumed.' };
  if (!(await apiKeyInfo(db, member.orgId))) return { ok: false, error: 'Save a Cognito API key first.' };
  const targets = (await batchOf(db, run)).filter((r) => r.status === 'paused' || r.status === 'failed');
  const ids = targets.map((r) => r.id);
  const { data, error } = await db.from('import_runs')
    .update({ status: 'queued', stop_requested: false, error: null, lease_until: null, finished_at: null })
    .eq('org_id', member.orgId).in('id', ids).in('status', ['paused', 'failed']).select('id, seq');
  if (isUniqueViolation(error)) return { ok: false, error: 'Another import for one of these forms is queued or running. Wait for it, or stop it first.' };
  if (error) throw new Error('import_runs update failed');
  const queued = ((data ?? []) as Array<{ id: string; seq: number }>).sort((a, b) => a.seq - b.seq);
  if (!queued.length) return { ok: false, error: 'Nothing to resume.' };
  await enqueue(db, member.orgId, IMPORT_QUEUE, { run_id: queued[0].id });
  return { ok: true, runIds: queued.map((r) => r.id) };
}

// ---------------------------------------------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------------------------------------------
const payloadSchema = z.object({ run_id: z.string().uuid() });

export interface SliceSummary {
  run: string;
  outcome: 'done' | 'limit' | 'budget' | 'stopped' | 'failed' | 'skipped';
  seen: number;
  error?: string;
}

/** Outbox handler for 'cognito.import'. Never throws for import problems: they end the run as failed (resumable). */
export async function runImportJob(db: SupabaseClient, job: Job, ctx?: { deadline: number }): Promise<void> {
  if (!job.org_id) throw new Error('job has no org');
  const parsed = payloadSchema.safeParse(job.payload);
  if (!parsed.success) throw new Error('job has no run');
  await importSlice(db, job.org_id, parsed.data.run_id, ctx?.deadline ?? Date.now() + SLICE_MS);
}

/** One slice of one run. Exported for tests; the deadline is when the caller wants control back. */
export async function importSlice(db: SupabaseClient, orgId: string, runId: string, callerDeadline: number, sliceMs = SLICE_MS): Promise<SliceSummary> {
  const started = Date.now();
  const deadline = Math.min(callerDeadline, started + sliceMs);
  if (deadline - started < Math.min(MIN_SLICE_MS, sliceMs / 2)) {
    // Too little time in this drain: let the next drain start the slice.
    await enqueue(db, orgId, IMPORT_QUEUE, { run_id: runId });
    return { run: runId, outcome: 'skipped', seen: 0 };
  }

  const { data: claimed, error: claimError } = await db.from('import_runs')
    .update({ status: 'running', lease_until: new Date(deadline + LEASE_MARGIN_MS).toISOString() })
    .eq('id', runId).eq('org_id', orgId).in('status', ['queued', 'running']).eq('stop_requested', false)
    .or(leaseFree(new Date(started).toISOString()))
    .select(RUN_COLS);
  if (claimError) throw new Error('import_runs claim failed');
  if (!claimed?.length) {
    // Paused, done or failed: nothing to do. Stop requested while no slice runs: pause it now. Another slice holds
    // the lease: it continues the chain itself.
    await db.from('import_runs').update({ status: 'paused', stop_requested: false, lease_until: null })
      .eq('id', runId).eq('org_id', orgId).in('status', ['queued', 'running']).eq('stop_requested', true)
      .or(leaseFree(new Date(started).toISOString()));
    return { run: runId, outcome: 'skipped', seen: 0 };
  }
  const run = claimed[0] as ImportRun;
  const save = async (fields: Record<string, unknown>) => {
    const { error } = await db.from('import_runs').update(fields).eq('id', run.id);
    if (error) throw new Error('import_runs update failed');
  };
  if (!run.started_at) await save({ started_at: new Date(started).toISOString() });

  return recordRun<SliceSummary>(db, orgId, IMPORT_QUEUE, async () => {
    let seenBefore = 0;
    let seenNow = 0;
    try {
      const apiKey = await loadApiKey(db, orgId);
      if (!apiKey) throw new ImportJobError('no_api_key');
      const sink = new SupabaseSink(db, orgId);
      const forms = await sink.loadForms();
      const form = forms.find((f) => f.slug === run.form_slug);
      if (!form) throw new ImportJobError('form_not_found');

      const cursor = parseCursor(run.cursor);
      const report = parseReport(run.report) ?? emptyFormReport(form.slug, form.spec.entryCountAtExport);
      seenBefore = report.seen;
      const keepPlanned = run.mode === 'dry_run' && lookupSources(forms.map((f) => f.spec)).has(form.slug);
      const planned = run.mode === 'dry_run' ? await plannedFromBatch(db, run, form) : undefined;
      const apply = run.mode === 'apply';

      const r = await runImportSlice({ source: cognitoSource(apiKey), sink, seal: sealData }, {
        form: form.slug, apply, limit: parseOptions(run.options).limit, report, planned, from: cursor.position, deadline,
        shouldStop: async () => {
          const { data } = await db.from('import_runs').select('stop_requested').eq('id', run.id).maybeSingle();
          return data?.stop_requested === true;
        },
        checkpoint: async (position, slicePlanned) => {
          await save({ report, cursor: { position, planned: keepPlanned ? mergePlanned(cursor.planned, slicePlanned) : [] } });
        },
      });
      seenNow = r.report.seen - seenBefore;
      const finalCursor = { position: r.position, planned: keepPlanned ? mergePlanned(cursor.planned, r.planned) : [] };

      if (r.outcome === 'budget') {
        await save({ report: r.report, cursor: finalCursor, lease_until: null });
        await enqueue(db, orgId, IMPORT_QUEUE, { run_id: run.id });
      } else if (r.outcome === 'stopped') {
        await save({ report: r.report, cursor: finalCursor, lease_until: null, status: 'paused', stop_requested: false });
      } else {
        await save({ report: r.report, cursor: finalCursor, lease_until: null, status: 'done', finished_at: new Date().toISOString() });
        if (apply) await enqueue(db, orgId, 'deal-files.rebuild', {}, { uniquePending: true });
        await startNextInBatch(db, run);
      }
      const failed = Object.values(r.report.failed).reduce((a, b) => a + b, 0);
      return { ok: true, processed: seenNow, error: failed ? `${failed} entries failed` : undefined, result: { run: run.id, outcome: r.outcome, seen: seenNow } };
    } catch (e) {
      const code = errorCode(e);
      // The report and cursor stay at the last checkpoint, so a resume neither skips nor double counts.
      await save({ status: 'failed', error: code, lease_until: null, finished_at: new Date().toISOString() });
      if (run.batch_id) {
        await db.from('import_runs').update({ status: 'paused' }).eq('org_id', orgId).eq('batch_id', run.batch_id).eq('status', 'queued');
      }
      return { ok: false, processed: seenNow, error: code, result: { run: run.id, outcome: 'failed' as const, seen: seenNow, error: code } };
    }
  });
}

/** The next queued form of an "All forms" batch gets its job. */
async function startNextInBatch(db: SupabaseClient, run: ImportRun): Promise<void> {
  if (!run.batch_id) return;
  const { data } = await db.from('import_runs').select('id').eq('org_id', run.org_id).eq('batch_id', run.batch_id).eq('status', 'queued').order('seq').limit(1);
  if (data?.length) await enqueue(db, run.org_id, IMPORT_QUEUE, { run_id: data[0].id as string });
}

/**
 * Dry run of a form that looks up another form (Delivery Note -> RFI) in an "All forms" dry run: the RFI ids that
 * the batch's RFI dry run planned count as "pending source import" instead of unresolved.
 */
async function plannedFromBatch(db: SupabaseClient, run: ImportRun, form: FormRecord): Promise<PlannedSources | undefined> {
  if (!run.batch_id) return undefined;
  const sources = [...lookupSources([form.spec])];
  if (!sources.length) return undefined;
  const { data } = await db.from('import_runs').select('form_slug, cursor').eq('org_id', run.org_id).eq('batch_id', run.batch_id).in('form_slug', sources);
  return new Map((data ?? []).map((r) => [r.form_slug as string, new Set(parseCursor(r.cursor).planned)]));
}

/** Drains only 'cognito.import' jobs (POST /api/jobs/cognito-import, and right after a start/resume). */
export async function drainImportJobs(db: SupabaseClient, budgetMs: number) {
  await releaseStuck(db);
  return drain(db, { [IMPORT_QUEUE]: runImportJob }, Date.now() + budgetMs, 5, [IMPORT_QUEUE]);
}
