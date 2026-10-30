import 'server-only';
// Form builder writes (M8 Part B). Callers have run requirePerm('forms.manage') (or adminForm(slug,
// 'forms.manage')) first; `db` is the service-role client, `userDb` the caller's RLS client. Audit rows carry ids
// and counts only. Pure rules live in names/layout/palette/workflow/spec.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FormRecord } from '@/lib/forms/forms';
import type { Member } from '@/lib/security/can';
import type { FormSpec } from '@/lib/spec/types';
import { loadForms } from '@/lib/forms/forms';
import { inputFields } from '@/lib/spec/types';
import { changeProblems, fieldsWithData, specProblems, type LookupSources } from './spec';

export type Result<T = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

async function audit(db: SupabaseClient, m: Member, action: string, formId: string, meta: Record<string, unknown> = {}) {
  await db.from('audit_log').insert({ org_id: m.orgId, actor_user: m.userId, action, entity: 'form', entity_id: formId, meta });
}

/** Lookup sources of the org: each form's field names (lookups must name a real field). */
export async function lookupSources(db: SupabaseClient, orgId: string): Promise<LookupSources> {
  return new Map((await loadForms(db, orgId)).map((f) => [f.slug, new Set(inputFields(f.spec).map((x) => x.name))]));
}

/** Slugs already used in the org (archived forms included: a slug is never reused). */
export async function orgSlugs(db: SupabaseClient, orgId: string): Promise<string[]> {
  const { data, error } = await db.from('forms').select('slug').eq('org_id', orgId);
  if (error) throw new Error('forms: could not list slugs');
  return (data ?? []).map((r) => r.slug as string);
}

/** form_statuses / form_roles mirror the published spec's workflow. */
async function syncWorkflowRows(db: SupabaseClient, formId: string, spec: FormSpec) {
  await db.from('form_statuses').delete().eq('form_id', formId);
  await db.from('form_roles').delete().eq('form_id', formId);
  const statuses = spec.workflow.statuses.map((s, i) => ({ form_id: formId, name: s.name, color: s.color, sort_order: i, archived: !!s.archived }));
  const roles = spec.workflow.roles.map((r) => ({ form_id: formId, name: r.name, is_public: !!r.public }));
  if (statuses.length) {
    const { error } = await db.from('form_statuses').insert(statuses);
    if (error) throw new Error('form_statuses: could not sync');
  }
  if (roles.length) {
    const { error } = await db.from('form_roles').insert(roles);
    if (error) throw new Error('form_roles: could not sync');
  }
}

function columnsOf(spec: FormSpec) {
  return {
    name: spec.name.trim(),
    internal_name: spec.internalName,
    entry_summary_template: spec.settings.entrySummary || null,
    encrypt_entries: !!spec.settings.encryptEntries,
  };
}

/** Creates a form whose first published version is `spec` (blank, duplicate or import). */
export async function createForm(
  db: SupabaseClient, m: Member, spec: FormSpec, o: { isActive: boolean; how: 'blank' | 'duplicate' | 'import'; sourceFormId?: string },
): Promise<Result<{ id: string; slug: string }>> {
  const { problems } = specProblems(spec, spec.slug, await lookupSources(db, m.orgId));
  if (problems.length) return { ok: false, problems };
  const { data: last } = await db.from('forms').select('sort_order').eq('org_id', m.orgId).order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('forms')
    .insert({
      org_id: m.orgId, slug: spec.slug, ...columnsOf(spec), cognito_form_id: null, sort_order: ((last?.sort_order as number | undefined) ?? 0) + 1,
      is_active: o.isActive, spec, version: 1, published_at: now, published_by: m.userId,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, problems: [/duplicate|unique/i.test(error?.message ?? '') ? 'Another form already uses this slug.' : 'Could not create the form.'] };
  const id = data.id as string;
  const v = await db.from('form_versions').insert({ form_id: id, version: 1, spec, note: o.how === 'blank' ? 'Created' : o.how === 'duplicate' ? 'Duplicated' : 'Imported', created_by: m.userId });
  if (v.error) throw new Error('form_versions: could not record version 1');
  await syncWorkflowRows(db, id, spec);
  await audit(db, m, o.how === 'import' ? 'form.import' : 'form.create', id, { how: o.how, fields: spec.fields.length, ...(o.sourceFormId ? { source: o.sourceFormId } : {}) });
  return { ok: true, id, slug: spec.slug };
}

/** Saves the designer's work in progress (any shape; it is checked on publish). */
export async function saveDraft(db: SupabaseClient, form: FormRecord, draft: unknown): Promise<void> {
  const { error } = await db.from('forms').update({ draft_spec: draft }).eq('id', form.id);
  if (error) throw new Error('forms: could not save the draft');
}

export async function discardDraft(db: SupabaseClient, form: FormRecord): Promise<void> {
  await db.from('forms').update({ draft_spec: null }).eq('id', form.id);
}

/** What the guards need: which fields hold data, and whether the form has entries. Read as the caller (RLS). */
export async function dataContext(userDb: SupabaseClient, form: FormRecord) {
  const { count, error } = await userDb.from('entries').select('id', { count: 'exact', head: true }).eq('form_id', form.id);
  if (error) throw new Error('entries: could not count');
  const hasEntries = (count ?? 0) > 0;
  const { data: keys, error: e2 } = await userDb.rpc('form_data_keys', { p_form: form.id });
  if (e2) throw new Error('form_data_keys failed');
  const withData = fieldsWithData(form.spec, (keys ?? []) as string[], { encrypted: form.encrypt, hasEntries });
  return { hasEntries, withData, encrypted: form.encrypt };
}

/** Publishes a draft: builder rules + guards, then version + 1 (optimistic on the version), history, workflow rows. */
export async function publish(
  db: SupabaseClient, userDb: SupabaseClient, m: Member, form: FormRecord, draft: unknown, note: string | null,
): Promise<Result<{ version: number }>> {
  const { spec, problems } = specProblems(draft, form.slug, await lookupSources(db, m.orgId));
  if (!spec || problems.length) return { ok: false, problems };
  const ctx = await dataContext(userDb, form);
  const guards = changeProblems(form.spec, spec, ctx);
  if (guards.length) return { ok: false, problems: guards };
  const version = (form.version ?? 1) + 1;
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('forms')
    .update({ ...columnsOf(spec), spec, version, draft_spec: null, published_at: now, published_by: m.userId })
    .eq('id', form.id)
    .eq('version', form.version ?? 1)
    .select('id');
  if (error) throw new Error('forms: could not publish');
  if (!data?.length) return { ok: false, problems: ['Someone else published this form meanwhile. Reload and try again.'] };
  const v = await db.from('form_versions').insert({ form_id: form.id, version, spec, note: note?.slice(0, 500) || null, created_by: m.userId });
  if (v.error) throw new Error('form_versions: could not record the version');
  await syncWorkflowRows(db, form.id, spec);
  await audit(db, m, 'form.publish', form.id, { version, fields: spec.fields.length });
  return { ok: true, version };
}

/** Puts a published version back as the draft (published spec unchanged until the next publish). */
export async function restoreAsDraft(db: SupabaseClient, m: Member, form: FormRecord, version: number): Promise<Result> {
  const { data } = await db.from('form_versions').select('spec').eq('form_id', form.id).eq('version', version).maybeSingle();
  if (!data) return { ok: false, problems: ['That version does not exist.'] };
  const spec = { ...(data.spec as Record<string, unknown>), slug: form.slug };
  await saveDraft(db, form, spec);
  await audit(db, m, 'form.restore_draft', form.id, { version });
  return { ok: true };
}

/** Archives a form: hidden from the forms list, public link off; entries and versions are kept. */
export async function archiveForm(db: SupabaseClient, m: Member, form: FormRecord): Promise<void> {
  const { error } = await db.from('forms').update({ archived_at: new Date().toISOString(), is_active: false }).eq('id', form.id);
  if (error) throw new Error('forms: could not archive');
  await audit(db, m, 'form.archive', form.id);
}
