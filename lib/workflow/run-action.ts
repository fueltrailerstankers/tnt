import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { appEnv } from '@/lib/env';
import { fileCountsOf, loadEntryById, loadFiles, sealData, type EntryFile, type EntryRecord } from '@/lib/forms/entries';
import type { FormRecord } from '@/lib/forms/forms';
import { loadOrg } from '@/lib/forms/org';
import { checkStaged, downloadObject, ENTRY_BUCKET, finalPath, moveObject, removeObjects, saveSignature } from '@/lib/forms/storage';
import { ensureDocument, hasInternalOnly, publicDocument, SIGNED_DOCUMENT_FORMS } from '@/lib/pdf/documents';
import { can, type Member } from '@/lib/security/can';
import { displayFileName } from '@/lib/security/files';
import { inputFields, type ActionSpec } from '@/lib/spec/types';
import { defaultData, prepareSave, readFormData, renderSummary, todayIn, validateEntry, type EntryData, type FileRef } from '@/lib/spec/values';
import { SIGNING, signatureMeta, termsBlocksFor } from '@/lib/terms/signing';
import { ensureTermsVersion } from '@/lib/terms/versions';
import { buildEmail, eventKey, isExternalEmail } from './email-template';
import { createRoleLink } from './links';
import { MAX_ATTACHMENT_BYTES, sendEmail, type Attachment } from './mailer';
import { enqueue } from '@/lib/jobs/outbox';
import { queueOf } from '@/lib/integrations/xero/write/types';
import { actionsForSave } from '@/lib/integrations/xero/write/triggers';
import { actionPermission, findAction, internalRole, isActionAllowed, NEW_ENTRY_STATUS, publicRole, roleByName } from './rules';

/** Who is acting. Public = the anonymous /f/<slug> link; link = a role link from an email; staff = signed-in member. */
export type Actor =
  | { kind: 'public' }
  | { kind: 'link'; roleName: string; entryId: string }
  | { kind: 'staff'; member: Member }
  | SystemActor;

// --- system actor (M3) ------------------------------------------------------------------------------
// Server jobs (e.g. release.on_paid creating a RELEASE FORM entry, as Make did through Cognito's public API)
// act as `system`. Only systemActor() can make one: the brand is a module-private symbol, which no server
// action argument or FormData can carry. allowedWhen is evaluated as the public role (what Make used); the
// timeline records actor_role 'System'.
const SYSTEM_BRAND: unique symbol = Symbol('system-actor');
export type SystemActor = { kind: 'system'; job: string; readonly [SYSTEM_BRAND]: true };
export function systemActor(job: string): SystemActor {
  return { kind: 'system', job, [SYSTEM_BRAND]: true };
}
export const SYSTEM_ROLE = 'System';

type Getter = { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] };

export interface RunInput {
  /** Service-role client. Callers must have authorised the actor (requirePerm / link check) first. */
  db: SupabaseClient;
  form: FormRecord;
  entry: EntryRecord | null;
  actionName: string;
  actor: Actor;
  fd: Getter;
  /** entries.updated_at the editor loaded; a mismatch means someone else saved in between. */
  expectedUpdatedAt?: string | null;
}

export type RunResult =
  | { ok: true; entryId: string; number: number; status: string; confirmation: string }
  | { ok: false; code: 400 | 403 | 409; errors: Record<string, string>; message: string };

const DEFAULT_CONFIRMATION = 'Thank you for filling out the form. Your response has been recorded.';

function fail(code: 400 | 403 | 409, message: string, errors: Record<string, string> = {}): RunResult {
  return { ok: false, code, message, errors };
}

export function roleOf(form: FormRecord, actor: Actor): string {
  if (actor.kind === 'public') return publicRole(form.spec).name;
  if (actor.kind === 'link') return actor.roleName;
  if (actor.kind === 'system') return publicRole(form.spec).name;
  return internalRole(form.spec).name;
}

/** Runs a spec workflow action: permission and allowedWhen, validation, save, files, events, documents, emails. */
export async function runAction(input: RunInput): Promise<RunResult> {
  const { db, form, entry, actor, fd } = input;
  const spec = form.spec;
  const action = findAction(spec, input.actionName);
  if (!action) return fail(400, 'Unknown action.');

  // --- who may do this -------------------------------------------------------------------------
  if (actor.kind === 'staff') {
    if (actor.member.orgId !== form.orgId) return fail(403, 'Not allowed.');
    if (!can(actor.member, actionPermission(action))) return fail(403, 'You do not have permission for this action.');
  }
  if (actor.kind === 'public' && (entry || !form.isActive)) return fail(403, 'This form is not available.');
  if (actor.kind === 'link') {
    if (!entry || entry.id !== actor.entryId || !roleByName(spec, actor.roleName)?.public) return fail(403, 'This link is not valid.');
  }
  if (actor.kind === 'system' && actor[SYSTEM_BRAND] !== true) return fail(403, 'Not allowed.');
  if (entry && (entry.formId !== form.id || entry.orgId !== form.orgId)) return fail(403, 'Not allowed.');
  const role = roleOf(form, actor);
  const fromStatus = entry?.status ?? NEW_ENTRY_STATUS;
  if (!isActionAllowed(action, fromStatus, role)) return fail(403, 'This action is not available for this entry.');
  if (entry && input.expectedUpdatedAt && input.expectedUpdatedAt !== entry.updatedAt) {
    return fail(409, 'This entry was changed by someone else. Reload it and try again.');
  }

  // --- read and validate -----------------------------------------------------------------------
  const org = await loadOrg(db, form.orgId);
  const read = readFormData(spec, fd, { timeZone: org.timezone, currency: org.currency });
  // M8: the public role cannot change readOnly/internalOnly fields (they keep the saved or default value), and
  // fields hidden by showWhen are neither validated nor saved; their files are left as they are.
  const previous = entry?.data ?? defaultData(spec, { today: todayIn(org.timezone), now: new Date(), timeZone: org.timezone, currency: org.currency });
  const prep = prepareSave(spec, read, { audience: actor.kind === 'public' || actor.kind === 'link' ? 'public' : 'staff', previous });
  const existing: EntryFile[] = entry ? await loadFiles(db, entry.id) : [];
  const plan = planFiles(form, read.files, read.signatures, existing, prep.skip);
  if (plan.errors) Object.assign(prep.errors, plan.errors);
  const errors = { ...validateEntry(spec, prep.data, plan.counts, { skip: prep.skip }), ...prep.errors };
  if (Object.keys(errors).length) return fail(400, 'Please correct the highlighted fields.', errors);

  const accepts = Object.fromEntries(inputFields(spec).map((f) => [f.name, f.type === 'file' ? f.accept : undefined]));
  const checks = await Promise.all(plan.staged.map((s) => checkStaged(db, s.ref, accepts[s.field])));
  checks.forEach((c, i) => {
    if (!c.ok) errors[plan.staged[i].field] = c.reason === 'type' ? 'This file type is not allowed.' : c.reason === 'size' ? 'File is too large (max 20 MB).' : 'Upload did not complete. Add the file again.';
  });
  if (Object.keys(errors).length) return fail(400, 'Please correct the highlighted fields.', errors);

  // --- save the entry --------------------------------------------------------------------------
  const id = entry?.id ?? randomUUID();
  const toStatus = action.newStatus ?? fromStatus;
  const summary = renderSummary(form.summaryTemplate, prep.data, { spec, timeZone: org.timezone }) || null;
  const sealed = sealData(form, id, prep.data);
  const now = new Date().toISOString();
  const actorUser = actor.kind === 'staff' ? actor.member.userId : null;
  let number: number;
  if (!entry) {
    const { data, error } = await db
      .from('entries')
      .insert({
        id, form_id: form.id, number: 0, status: toStatus, ...sealed, summary, created_by: actorUser,
        submitted_at: toStatus !== NEW_ENTRY_STATUS ? now : null,
      })
      .select('number')
      .single();
    if (error || !data) throw new Error('Could not save the entry');
    number = data.number;
  } else {
    const patch: Record<string, unknown> = { status: toStatus, ...sealed, summary };
    if (!entry.submittedAt && toStatus !== NEW_ENTRY_STATUS) patch.submitted_at = now;
    const { data, error } = await db.from('entries').update(patch).eq('id', entry.id).eq('updated_at', entry.updatedAt).select('number');
    if (error) throw new Error('Could not save the entry');
    if (!data?.length) return fail(409, 'This entry was changed by someone else. Reload it and try again.');
    number = entry.number;
  }

  // --- files and signatures --------------------------------------------------------------------
  const sortBase = existing.reduce((m, f) => Math.max(m, f.sortOrder), 0) + 1;
  const newRows: Record<string, unknown>[] = [];
  for (const [i, s] of plan.staged.entries()) {
    const c = checks[i] as Extract<(typeof checks)[number], { ok: true }>;
    const to = finalPath(form.slug, id, s.field, s.ref.name);
    await moveObject(db, s.ref.path, to);
    newRows.push({ entry_id: id, field_key: s.field, kind: 'file', storage_path: to, file_name: displayFileName(s.ref.name), content_type: c.contentType, size_bytes: c.size, sort_order: sortBase + i });
  }
  // Rule 12: signatures on a signing form record the exact terms version shown, the signer role and the server time.
  const termsVersionId = SIGNING[form.slug] && plan.newSignatures.length ? await ensureTermsVersion(db, form.orgId, SIGNING[form.slug].key, termsBlocksFor(spec)) : null;
  for (const [i, s] of plan.newSignatures.entries()) {
    const to = finalPath(form.slug, id, s.field, 'signature.png');
    const size = await saveSignature(db, to, s.dataUrl);
    newRows.push({
      entry_id: id, field_key: s.field, kind: 'signature', storage_path: to, file_name: `${s.field}.png`, content_type: 'image/png', size_bytes: size, sort_order: sortBase + plan.staged.length + i,
      ...(signatureMeta(form.slug, s.field, termsVersionId, now) ?? {}),
    });
  }
  if (newRows.length) {
    const { error } = await db.from('entry_files').insert(newRows);
    if (error) throw new Error('Could not record the files');
  }
  if (plan.removed.length) {
    await db.from('entry_files').delete().in('id', plan.removed.map((f) => f.id));
    await removeObjects(db, ENTRY_BUCKET, plan.removed.map((f) => f.storagePath));
  }

  // --- timeline --------------------------------------------------------------------------------
  const changed = diffKeys(entry?.data ?? {}, prep.data, plan);
  await db.from('entry_events').insert({
    entry_id: id, action: action.name, from_status: entry ? fromStatus : null, to_status: toStatus,
    actor_user: actorUser, actor_role: actor.kind === 'system' ? SYSTEM_ROLE : role, diff: { changed },
  });

  // --- documents and emails (after the save; failures are logged, the save stands) ------------------
  const saved = await loadEntryById(db, form, id);
  if (!saved) throw new Error('Saved entry not found');
  await afterSave(db, form, saved, action, actorUser);

  return { ok: true, entryId: id, number, status: toStatus, confirmation: action.confirmation ?? DEFAULT_CONFIRMATION };
}

interface FilePlan {
  counts: Record<string, number>;
  staged: Array<{ field: string; ref: Extract<FileRef, { kind: 'staged' }> }>;
  newSignatures: Array<{ field: string; dataUrl: string }>;
  removed: EntryFile[];
  errors?: Record<string, string>;
}

/** Works out which files stay, which are new and which go, per field. Existing ids must belong to this entry and field. */
export function planFiles(
  form: FormRecord, files: Record<string, FileRef[]>, signatures: ReturnType<typeof readFormData>['signatures'], existing: EntryFile[],
  /** M8: fields left exactly as they are (hidden by showWhen or locked for the actor): no new, none removed. */
  keep: ReadonlySet<string> = new Set(),
): FilePlan {
  const plan: FilePlan = { counts: {}, staged: [], newSignatures: [], removed: [] };
  const errors: Record<string, string> = {};
  for (const f of inputFields(form.spec)) {
    const mine = existing.filter((e) => e.fieldKey === f.name);
    if (keep.has(f.name) && (f.type === 'file' || f.type === 'signature')) {
      plan.counts[f.name] = mine.length;
      continue;
    }
    if (f.type === 'file') {
      const refs = files[f.name] ?? [];
      const keep = new Set<string>();
      for (const r of refs) {
        if (r.kind === 'existing') {
          if (mine.some((m) => m.id === r.id)) keep.add(r.id);
          else errors[f.name] = 'A file in this field is no longer available. Reload the page.';
        } else if (r.path.split('/')[2] !== f.name) {
          errors[f.name] = 'Upload did not complete. Add the file again.';
        } else {
          plan.staged.push({ field: f.name, ref: r });
        }
      }
      plan.removed.push(...mine.filter((m) => !keep.has(m.id)));
      plan.counts[f.name] = keep.size + refs.filter((r) => r.kind === 'staged').length;
    } else if (f.type === 'signature') {
      const s = signatures[f.name] ?? null;
      if (s?.kind === 'keep') {
        if (!mine.some((m) => m.id === s.id)) errors[f.name] = 'Sign again.';
        plan.removed.push(...mine.filter((m) => m.id !== s.id));
        plan.counts[f.name] = 1;
      } else {
        plan.removed.push(...mine);
        if (s?.kind === 'new') plan.newSignatures.push({ field: f.name, dataUrl: s.dataUrl });
        plan.counts[f.name] = s ? 1 : 0;
      }
    }
  }
  if (Object.keys(errors).length) plan.errors = errors;
  return plan;
}

/** Field keys whose value changed. Keys only: the timeline never stores personal data values. */
function diffKeys(before: EntryData, after: EntryData, plan: FilePlan): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  for (const s of plan.staged) changed.push(s.field);
  for (const s of plan.newSignatures) changed.push(s.field);
  for (const r of plan.removed) changed.push(r.fieldKey);
  return [...new Set(changed)].sort();
}

async function afterSave(db: SupabaseClient, form: FormRecord, entry: EntryRecord, action: ActionSpec, actorUser: string | null) {
  const env = appEnv();
  const org = await loadOrg(db, form.orgId);
  const adminLink = `${env.APP_URL}/admin/forms/${form.slug}/entries/${entry.number}`;
  await enqueueXeroActions(db, form, entry, action.name).catch(() => undefined); // M3: see below

  if (SIGNED_DOCUMENT_FORMS.has(form.slug) && entry.status !== NEW_ENTRY_STATUS) {
    await ensureDocument(db, form, entry, 1, org.timezone, actorUser).catch(() => undefined);
  }
  if (!action.emails.length) return;

  const key = eventKey(form.slug, action.name);
  const { data: rec } = await db.from('notification_recipients').select('address').eq('org_id', form.orgId).eq('event_key', key).eq('active', true);
  const configured = (rec ?? []).map((r) => r.address as string);
  const files = await loadFiles(db, entry.id);
  const counts = fileCountsOf(files);

  for (const email of action.emails) {
    let roleLink: string | undefined;
    if (email.linkForRole) {
      const r = roleByName(form.spec, email.linkForRole);
      roleLink = r?.public ? `${env.APP_URL}/e/${await createRoleLink(db, entry.id, r.name)}` : adminLink;
    }
    const built = buildEmail(email, action.name, {
      spec: form.spec, data: entry.data, entryNumber: entry.number, status: entry.status, adminLink, roleLink, configuredRecipients: configured, fileCounts: counts,
      timeZone: org.timezone,
    });
    const attachments: Attachment[] = [];
    let total = 0;
    const add = (a: Attachment) => {
      if (total + a.content.length > MAX_ATTACHMENT_BYTES) return;
      total += a.content.length;
      attachments.push(a);
    };
    const docNumbers = new Set<number>(email.attachDocuments ?? []);
    if (email.includeDocumentAttachments) docNumbers.add(1);
    // M8: an email to an address from the entry gets a PDF and files without internalOnly fields.
    const external = isExternalEmail(email) && hasInternalOnly(form);
    const internalNames = new Set(external ? inputFields(form.spec).filter((f) => 'internalOnly' in f && f.internalOnly).map((f) => f.name) : []);
    for (const n of docNumbers) {
      const doc = external && n === 1
        ? await publicDocument(db, form, entry, org.timezone).catch(() => null)
        : await ensureDocument(db, form, entry, n, org.timezone, actorUser).catch(() => null);
      if (doc) add({ filename: doc.name, content: doc.bytes, contentType: 'application/pdf' });
    }
    if (email.includeAttachments) {
      for (const f of files.filter((x) => x.kind === 'file' && !internalNames.has(x.fieldKey))) {
        const b = await downloadObject(db, ENTRY_BUCKET, f.storagePath);
        if (b) add({ filename: f.fileName, content: b, contentType: f.contentType ?? undefined });
      }
    }
    await sendEmail(db, { ...built, entryId: entry.id, action: action.name, eventKey: key, attachments });
  }
}


// --- M3 hook-ins ------------------------------------------------------------------------------------
/** RFI / Delivery Note Submit+Update and DEAL Submit enqueue their Xero action. The job checks the mode. */
async function enqueueXeroActions(db: SupabaseClient, form: FormRecord, entry: EntryRecord, actionName: string) {
  for (const a of actionsForSave(form.slug, actionName)) {
    await enqueue(db, form.orgId, queueOf(a), { entryId: entry.id });
  }
}

/**
 * Internal update helper for server jobs (deal.import_quote). It is the runAction save path without the form
 * read: it merges `patch` into the entry's data (encrypted forms stay encrypted), re-renders the summary,
 * saves with the same optimistic concurrency check, and records an entry_events row (changed keys only,
 * actor_role 'System'). No status change, no files, no emails. Only text and number fields can be patched.
 */
export async function systemUpdateEntry(
  db: SupabaseClient, form: FormRecord, entryId: string, patch: Record<string, unknown>, eventAction: string,
): Promise<{ ok: true; changed: string[] } | { ok: false; reason: string }> {
  const entry = await loadEntryById(db, form, entryId);
  if (!entry) return { ok: false, reason: 'entry not found' };
  const types = new Map(inputFields(form.spec).map((f) => [f.name, f.type]));
  const data: EntryData = { ...entry.data };
  for (const [k, v] of Object.entries(patch)) {
    const t = types.get(k);
    if (t !== 'text' && t !== 'number') return { ok: false, reason: `field ${k} cannot be patched` };
    if (v === null || v === undefined || v === '') delete data[k];
    else if (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === 'string') data[k] = v;
    else return { ok: false, reason: `bad value for ${k}` };
  }
  const changed = Object.keys(patch).filter((k) => JSON.stringify(entry.data[k]) !== JSON.stringify(data[k])).sort();
  if (!changed.length) return { ok: true, changed };
  const sealed = sealData(form, entry.id, data);
  const summary = renderSummary(form.summaryTemplate, data) || null;
  const { data: rows, error } = await db.from('entries').update({ ...sealed, summary }).eq('id', entry.id).eq('updated_at', entry.updatedAt).select('id');
  if (error) throw new Error('Could not save the entry');
  if (!rows?.length) return { ok: false, reason: 'entry changed meanwhile' };
  await db.from('entry_events').insert({
    entry_id: entry.id, action: eventAction, from_status: entry.status, to_status: entry.status,
    actor_user: null, actor_role: SYSTEM_ROLE, diff: { changed },
  });
  return { ok: true, changed };
}
