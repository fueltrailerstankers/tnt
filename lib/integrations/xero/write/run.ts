import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadEntryById, loadFiles } from '@/lib/forms/entries';
import { loadForm } from '@/lib/forms/forms';
import { loadOrg } from '@/lib/forms/org';
import { downloadObject, ENTRY_BUCKET } from '@/lib/forms/storage';
import { ensureDocument } from '@/lib/pdf/documents';
import { runAction, systemActor, systemUpdateEntry } from '@/lib/workflow/run-action';
import { sendEmail, type Attachment } from '@/lib/workflow/mailer';
import { loadConnection, type Connection } from '../connection';
import { loadDealInput, loadDeliveryInput, loadMergeInput, loadReleaseInput, loadRfiInput, Refresher } from './load';
import { resolveMode, settingKey, type ActionMode } from './modes';
import { planDealImport } from './plan-deal';
import { planDeliveryInvoice } from './plan-delivery';
import { planMerge } from './plan-merge';
import { planRelease } from './plan-release';
import { planRfiInvoice } from './plan-rfi';
import { redactEffect, redactError, redactRequest, redactValue } from './redact';
import { emptyPlan, type ActionName, type Effect, type FileSource, type Plan } from './types';
import { ClaimHeld, executePlan, XeroWriter, type ExecResult, type FileLoader } from './writer';

// Runs one action for one source (entry or invoice): mode -> inputs -> plan -> record -> (send) -> effects.
// Every attempt is a xero_action_runs row. Nothing personal is stored: requests, effects and errors are redacted.

/** Thrown to make the outbox retry later (e.g. the invoice is not in Xero yet). */
export class RetryLater extends Error {
  constructor(reason: string) {
    super(`retry later: ${reason}`);
    this.name = 'RetryLater';
  }
}

export interface ActionPayload {
  entryId?: string;
  invoiceId?: string;
}

export async function actionMode(db: SupabaseClient, orgId: string, action: ActionName, conn: Connection | null) {
  const { data } = await db.from('app_settings').select('value').eq('org_id', orgId).eq('key', settingKey(action)).maybeSingle();
  return resolveMode(action, data?.value, conn);
}

const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function startRun(db: SupabaseClient, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await db.from('xero_action_runs').insert(row).select('id').single();
  if (error || !data) throw new Error('could not record the action run');
  return data.id as string;
}

async function finishRun(db: SupabaseClient, id: string, patch: Record<string, unknown>) {
  await db.from('xero_action_runs').update({ ...patch, finished_at: new Date().toISOString() }).eq('id', id);
}

async function buildPlan(db: SupabaseClient, orgId: string, action: ActionName, p: ActionPayload, r: Refresher, tz: string): Promise<Plan & { outline?: unknown }> {
  const missing = (what: string) => emptyPlan(action, `${action}:${p.entryId ?? p.invoiceId ?? 'none'}`, 'skip', `${what} not found`);
  switch (action) {
    case 'deal.import_quote': {
      const i = isUuid(p.entryId) ? await loadDealInput(db, orgId, p.entryId, r) : null;
      return i ? planDealImport(i) : missing('entry');
    }
    case 'rfi.create_invoice': {
      const i = isUuid(p.entryId) ? await loadRfiInput(db, orgId, p.entryId, r, todayIn(tz)) : null;
      return i ? planRfiInvoice(i) : missing('entry');
    }
    case 'delivery.update_invoice': {
      const i = isUuid(p.entryId) ? await loadDeliveryInput(db, orgId, p.entryId, r) : null;
      return i ? planDeliveryInvoice(i) : missing('entry');
    }
    case 'release.on_paid': {
      const i = typeof p.invoiceId === 'string' ? await loadReleaseInput(db, orgId, p.invoiceId, r) : null;
      return i ? planRelease(i) : missing('invoice');
    }
    case 'invoice.merge_attachments': {
      const i = typeof p.invoiceId === 'string' ? await loadMergeInput(db, orgId, p.invoiceId) : null;
      return i ? planMerge(i) : missing('invoice');
    }
  }
}

/** Loads the raw body of an attachment upload: a stored entry file, or the current version of a document. */
function fileLoader(db: SupabaseClient, orgId: string, tz: string): FileLoader {
  return async (f: FileSource) => {
    if (f.kind === 'entry_file') {
      const files = await loadFiles(db, f.entryId);
      const row = files.find((x) => x.id === f.fileId);
      if (!row) return null;
      const bytes = await downloadObject(db, ENTRY_BUCKET, row.storagePath);
      return bytes ? { bytes, contentType: row.contentType ?? 'application/octet-stream' } : null;
    }
    const form = await loadForm(db, orgId, f.formSlug);
    const entry = form ? await loadEntryById(db, form, f.entryId) : null;
    if (!form || !entry) return null;
    const doc = await ensureDocument(db, form, entry, f.template, tz, null);
    return { bytes: doc.bytes, contentType: 'application/pdf' };
  };
}

/** Runs an action. Returns the run status. Throws RetryLater / errors so the outbox retries with backoff. */
export async function performXeroAction(db: SupabaseClient, orgId: string, action: ActionName, payload: ActionPayload): Promise<string> {
  const conn = await loadConnection(db, orgId);
  const resolved = await actionMode(db, orgId, action, conn);
  const source = { source_entry_id: isUuid(payload.entryId) ? payload.entryId : null, source_ref: typeof payload.invoiceId === 'string' ? payload.invoiceId.slice(0, 64) : null };

  if (resolved.mode === 'off') {
    await startRun(db, { org_id: orgId, action, idempotency_key: `${action}:${payload.entryId ?? payload.invoiceId ?? 'none'}`, mode: 'off', status: 'skipped', reason: 'mode off', ...source, finished_at: new Date().toISOString() });
    return 'skipped';
  }

  const mode: Exclude<ActionMode, 'off'> = resolved.mode;
  const org = await loadOrg(db, orgId);
  const refresher = new Refresher(db, conn, mode === 'live');
  const plan = await buildPlan(db, orgId, action, payload, refresher, org.timezone);
  await refresher.flush();

  const display = {
    planned_requests: plan.requests.map(redactRequest),
    effects: plan.effects.map(redactEffect),
    expected: redactValue({ ...plan.expected, ...(plan.outline ? { outline: plan.outline } : {}) }),
  };
  const reasonText = [plan.reason, resolved.downgraded ? `live requested: ${resolved.downgraded}` : null].filter(Boolean).join('; ') || null;
  const runId = await startRun(db, {
    org_id: orgId, action, idempotency_key: plan.idempotencyKey, mode, ...source, ...display,
    status: plan.status === 'ready' ? (mode === 'live' && plan.requests.length ? 'sent' : 'planned') : plan.status === 'skip' ? 'skipped' : 'failed',
    reason: reasonText,
  });
  if (plan.status === 'skip') {
    await finishRun(db, runId, {});
    return 'skipped';
  }
  if (plan.status === 'retry') {
    await finishRun(db, runId, { error: plan.reason ?? 'waiting' });
    throw new RetryLater(plan.reason ?? 'waiting');
  }

  const writer = new XeroWriter({ db, orgId, mode, connection: conn });
  let exec: ExecResult;
  try {
    exec = await executePlan(writer, plan, fileLoader(db, orgId, org.timezone));
  } catch (e) {
    await finishRun(db, runId, { status: 'failed', error: e instanceof ClaimHeld ? 'claim held without result: needs review' : redactError(e), response_summary: { sent: writer.recorded.filter((x) => !x.dryRun).map((x) => ({ step: x.step, status: x.status })) } });
    if (e instanceof ClaimHeld) return 'failed'; // do not retry: a person must check Xero first
    throw e;
  }

  let effects: Record<string, unknown>[] = [];
  try {
    // Dry run changes nothing: our own effects (entries, mappings, emails) are only recorded (display.effects).
    effects = mode === 'live'
      ? await applyEffects(db, orgId, plan, exec, mode, writer, org.timezone)
      : plan.effects.map((e) => ({ kind: e.kind, outcome: 'dry run: not applied' }));
  } catch (e) {
    await finishRun(db, runId, { status: 'failed', error: redactError(e), response_summary: { steps: exec.steps } });
    throw e;
  }
  await finishRun(db, runId, {
    status: mode === 'live' || !plan.requests.length ? 'succeeded' : 'planned',
    response_summary: { steps: exec.steps, effects },
  });
  return mode === 'live' ? 'succeeded' : 'planned';
}

// ---------------------------------------------------------------------------------------------------
// Effects: our own entries, mappings and emails. They run in live only; dry run records them without applying.
// ---------------------------------------------------------------------------------------------------
async function applyEffects(
  db: SupabaseClient, orgId: string, plan: Plan, exec: ExecResult, mode: 'dry_run' | 'live', writer: XeroWriter, tz: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const captures = { ...exec.captures };
  for (const e of plan.effects) {
    out.push(await applyEffect(db, orgId, plan, e, captures, mode, writer, tz));
  }
  return out;
}

const fill = (s: string, captures: Record<string, string>) => s.replace(/\{\{([a-z_]+)\}\}/g, (_, n: string) => captures[n] ?? '');

/** One-shot guard for non-Xero side effects (entries, emails) so a replayed job does not repeat them. */
async function once(db: SupabaseClient, orgId: string, key: string): Promise<{ first: boolean; result: Record<string, unknown> | null }> {
  const ins = await db.from('action_claims').insert({ org_id: orgId, action_key: key }).select('id');
  if (!ins.error && ins.data?.length) return { first: true, result: null };
  const { data } = await db.from('action_claims').select('result').eq('org_id', orgId).eq('action_key', key).maybeSingle();
  return { first: false, result: (data?.result as Record<string, unknown> | null) ?? null };
}
async function done(db: SupabaseClient, orgId: string, key: string, result: Record<string, unknown>) {
  await db.from('action_claims').update({ result }).eq('org_id', orgId).eq('action_key', key);
}

async function applyEffect(
  db: SupabaseClient, orgId: string, plan: Plan, e: Effect, captures: Record<string, string>, mode: 'dry_run' | 'live', writer: XeroWriter, tz: string,
): Promise<Record<string, unknown>> {
  switch (e.kind) {
    case 'entry.patch': {
      const form = await loadForm(db, orgId, e.formSlug);
      if (!form) throw new Error('form missing');
      const r = await systemUpdateEntry(db, form, e.entryId, e.fields, 'XeroQuoteImport');
      if (!r.ok) throw new RetryLater(r.reason);
      return { kind: e.kind, changed: r.changed };
    }
    case 'entry.submit':
    case 'entry.update': {
      const key = `${plan.idempotencyKey}#entry`;
      const g = await once(db, orgId, key);
      if (!g.first) {
        if (typeof g.result?.entryId === 'string') {
          captures.release_entry = g.result.entryId;
          return { kind: e.kind, outcome: 'already_done', entryId: g.result.entryId };
        }
        throw new ClaimHeld(key);
      }
      const form = await loadForm(db, orgId, e.formSlug);
      if (!form) throw new Error('form missing');
      const entry = e.kind === 'entry.update' ? await loadEntryById(db, form, e.entryId) : null;
      if (e.kind === 'entry.update' && !entry) throw new Error('mapped entry missing');
      const fd = formDataOf(e.values);
      const res = await runAction({ db, form, entry, actionName: entry ? 'Update' : 'Submit', actor: systemActor(plan.action), fd });
      if (!res.ok) {
        await db.from('action_claims').delete().eq('org_id', orgId).eq('action_key', key).is('result', null);
        throw new Error(`release entry not saved (${res.code})`);
      }
      await done(db, orgId, key, { entryId: res.entryId });
      captures.release_entry = res.entryId;
      return { kind: e.kind, entryId: res.entryId, number: res.number };
    }
    case 'external_ref': {
      if (e.needsLive && mode !== 'live') return { kind: e.kind, entity: e.entity, outcome: 'needs live' };
      const externalId = fill(e.externalId, captures);
      const internalId = fill(e.internalId, captures);
      if (!externalId || !internalId) return { kind: e.kind, entity: e.entity, outcome: 'no id' };
      await db.from('external_refs').upsert({ org_id: orgId, source: 'xero', entity: e.entity, external_id: externalId, internal_id: internalId }, { onConflict: 'org_id,source,entity,external_id', ignoreDuplicates: true });
      return { kind: e.kind, entity: e.entity, outcome: 'recorded' };
    }
    case 'email':
      return sendReleaseEmail(db, orgId, plan, e, captures, writer, tz);
  }
}

function formDataOf(values: Record<string, string>) {
  const m = new Map(Object.entries(values).map(([k, v]) => [`f.${k}`, v]));
  return { get: (n: string) => m.get(n) ?? null, getAll: (n: string) => (m.has(n) ? [m.get(n)!] : []) };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function sendReleaseEmail(
  db: SupabaseClient, orgId: string, plan: Plan, e: Extract<Effect, { kind: 'email' }>, captures: Record<string, string>, writer: XeroWriter, tz: string,
): Promise<Record<string, unknown>> {
  const key = `${plan.idempotencyKey}#email`;
  const g = await once(db, orgId, key);
  if (!g.first) return { kind: 'email', outcome: 'already_sent' };
  const entryId = captures.release_entry;
  const { data: rec } = await db.from('notification_recipients').select('address').eq('org_id', orgId).eq('event_key', e.eventKey).eq('active', true);
  const to = (rec ?? []).map((r) => r.address as string);
  const attachments: Attachment[] = [];
  const invoiceId = plan.idempotencyKey.split(':')[1];
  const pdf = await writer.download(`/Invoices/${encodeURIComponent(invoiceId)}`, 'application/pdf').catch(() => null);
  const invNo = e.lines.find(([k]) => k === 'Invoice Number')?.[1] ?? invoiceId;
  if (pdf) attachments.push({ filename: `${invNo.replace(/[\\/:*?"<>|]/g, '-')}.pdf`, content: pdf, contentType: 'application/pdf' });
  if (entryId) {
    const form = await loadForm(db, orgId, 'release-form');
    const entry = form ? await loadEntryById(db, form, entryId) : null;
    if (form && entry) {
      const doc = await ensureDocument(db, form, entry, 1, tz, null).catch(() => null);
      if (doc) attachments.push({ filename: doc.name, content: doc.bytes, contentType: 'application/pdf' });
    }
  }
  const text = e.lines.map(([k, v]) => `${k}: ${v}`).join('\n');
  const html = `<table>${e.lines.map(([k, v]) => `<tr><th align="left">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
  if (!entryId) {
    await done(db, orgId, key, { status: 'skipped' });
    return { kind: 'email', outcome: 'no release entry' };
  }
  const status = await sendEmail(db, { to, subject: e.subject, html, text, entryId, action: 'release.on_paid', eventKey: e.eventKey, attachments });
  await done(db, orgId, key, { status });
  return { kind: 'email', outcome: status, recipients: to.length, attachments: attachments.length };
}
