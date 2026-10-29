import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptJson, encryptJson, parseKey } from '@/lib/security/crypto';
import type { EntryData } from '@/lib/spec/values';
import type { FormRecord } from './forms';

export interface EntryRecord {
  id: string;
  formId: string;
  orgId: string;
  number: number;
  status: string;
  summary: string | null;
  data: EntryData;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
}

export interface EntryFile {
  id: string;
  fieldKey: string;
  kind: 'file' | 'signature' | 'document';
  storagePath: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  sortOrder: number;
}

export const ENTRY_COLUMNS = 'id, form_id, org_id, number, status, summary, data, data_encrypted, created_at, updated_at, submitted_at';

export type EntryRow = {
  id: string; form_id: string; org_id: string; number: number; status: string; summary: string | null;
  data: EntryData; data_encrypted: string | null; created_at: string; updated_at: string; submitted_at: string | null;
};

function entryKey(): Buffer {
  return parseKey(process.env.ENTRY_ENCRYPTION_KEY, 'ENTRY_ENCRYPTION_KEY');
}

/** Encrypted forms keep only summary, number and status in clear; data is bound to the entry id. */
export function sealData(form: FormRecord, entryId: string, data: EntryData): { data: EntryData; data_encrypted: string | null } {
  if (!form.encrypt) return { data, data_encrypted: null };
  return { data: {}, data_encrypted: encryptJson(data, entryKey(), entryId) };
}

export function openRow(form: FormRecord, r: EntryRow): EntryRecord {
  let data = r.data ?? {};
  if (form.encrypt && r.data_encrypted) data = decryptJson<EntryData>(r.data_encrypted, entryKey(), r.id);
  return {
    id: r.id, formId: r.form_id, orgId: r.org_id, number: r.number, status: r.status, summary: r.summary, data,
    createdAt: r.created_at, updatedAt: r.updated_at, submittedAt: r.submitted_at,
  };
}

export async function loadEntryByNumber(db: SupabaseClient, form: FormRecord, number: number): Promise<EntryRecord | null> {
  if (!Number.isInteger(number) || number < 1) return null;
  const { data, error } = await db.from('entries').select(ENTRY_COLUMNS).eq('form_id', form.id).eq('number', number).maybeSingle();
  if (error) throw new Error(`entries: ${error.message}`);
  return data ? openRow(form, data as EntryRow) : null;
}

export async function loadEntryById(db: SupabaseClient, form: FormRecord, id: string): Promise<EntryRecord | null> {
  const { data, error } = await db.from('entries').select(ENTRY_COLUMNS).eq('form_id', form.id).eq('id', id).maybeSingle();
  if (error) throw new Error(`entries: ${error.message}`);
  return data ? openRow(form, data as EntryRow) : null;
}

export async function loadFiles(db: SupabaseClient, entryId: string): Promise<EntryFile[]> {
  const { data, error } = await db
    .from('entry_files')
    .select('id, field_key, kind, storage_path, file_name, content_type, size_bytes, sort_order')
    .eq('entry_id', entryId)
    .order('sort_order');
  if (error) throw new Error(`entry_files: ${error.message}`);
  return (data ?? []).map((f) => ({
    id: f.id, fieldKey: f.field_key, kind: f.kind, storagePath: f.storage_path, fileName: f.file_name,
    contentType: f.content_type, sizeBytes: f.size_bytes, sortOrder: f.sort_order,
  }));
}

export function fileCountsOf(files: EntryFile[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of files) out[f.fieldKey] = (out[f.fieldKey] ?? 0) + 1;
  return out;
}
