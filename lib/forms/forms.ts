import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseSpec, type FormSpec } from '@/lib/spec/types';

export interface FormRecord {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  isActive: boolean;
  encrypt: boolean;
  summaryTemplate: string;
  spec: FormSpec;
  /** M8: published version, unparsed draft (null = none) and archive time. */
  version?: number;
  draftSpec?: unknown;
  archivedAt?: string | null;
}

const COLUMNS = 'id, org_id, slug, name, is_active, encrypt_entries, entry_summary_template, spec, version, draft_spec, archived_at';

type Row = {
  id: string; org_id: string; slug: string; name: string; is_active: boolean;
  encrypt_entries: boolean; entry_summary_template: string | null; spec: unknown;
  version?: number; draft_spec?: unknown; archived_at?: string | null;
};

function toRecord(r: Row): FormRecord {
  const spec = parseSpec(r.spec);
  return {
    id: r.id, orgId: r.org_id, slug: r.slug, name: r.name, isActive: r.is_active,
    encrypt: r.encrypt_entries, summaryTemplate: r.entry_summary_template ?? spec.settings.entrySummary, spec,
    version: r.version ?? 1, draftSpec: r.draft_spec ?? null, archivedAt: r.archived_at ?? null,
  };
}

/** Loads a form by slug within an org. Works with either client; RLS applies to the user client. */
export async function loadForm(db: SupabaseClient, orgId: string, slug: string): Promise<FormRecord | null> {
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  const { data, error } = await db.from('forms').select(COLUMNS).eq('org_id', orgId).eq('slug', slug).maybeSingle();
  if (error) throw new Error(`forms: ${error.message}`);
  return data ? toRecord(data as Row) : null;
}

export async function loadForms(db: SupabaseClient, orgId: string): Promise<FormRecord[]> {
  const { data, error } = await db.from('forms').select(COLUMNS).eq('org_id', orgId).order('sort_order');
  if (error) throw new Error(`forms: ${error.message}`);
  return (data as Row[]).map(toRecord);
}

export async function loadFormById(db: SupabaseClient, formId: string): Promise<FormRecord | null> {
  const { data, error } = await db.from('forms').select(COLUMNS).eq('id', formId).maybeSingle();
  if (error) throw new Error(`forms: ${error.message}`);
  return data ? toRecord(data as Row) : null;
}
