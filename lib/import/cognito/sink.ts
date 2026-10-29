// The platform side of the import: the few reads and writes the importer needs. supabase-sink.ts implements it
// with the service-role client; memory-sink.ts implements it in memory (tests and offline dry-runs).
import type { FormRecord } from '@/lib/forms/forms';

export interface EntryKey {
  id: string;
  number: number;
  cognito_entry_id: string | null;
}

export interface EntryInsert {
  id: string;
  form_id: string;
  number: number;
  status: string;
  data: Record<string, unknown>;
  data_encrypted: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  cognito_entry_id: string;
}

export interface EntryFileInsert {
  entry_id: string;
  field_key: string;
  kind: 'file' | 'signature';
  storage_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sort_order: number;
}

export interface EntryEventInsert {
  entry_id: string;
  action: 'Import';
  from_status: null;
  to_status: string;
  actor_user: null;
  actor_role: 'Import';
  diff: { changed: string[]; source: 'cognito' };
}

export interface ImportSink {
  readonly orgId: string;
  loadForms(): Promise<FormRecord[]>;
  /** external_refs for (org, source 'cognito', entity): external id -> internal id. */
  loadRefs(entity: string): Promise<Map<string, string>>;
  /** Every entry of a form (id, number, cognito id), to detect resumes and number clashes. */
  listEntryKeys(formId: string): Promise<EntryKey[]>;
  insertEntry(row: EntryInsert): Promise<void>;
  listFilePaths(entryId: string): Promise<string[]>;
  /** Upload to the entry-files bucket, overwriting a partial object left by a crash. */
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  insertFile(row: EntryFileInsert): Promise<void>;
  hasImportEvent(entryId: string): Promise<boolean>;
  insertEvent(row: EntryEventInsert): Promise<void>;
  /** Idempotent: an existing (org, source, entity, external id) row is left alone. */
  insertRef(entity: string, externalId: string, internalId: string): Promise<void>;
  maxNumber(formId: string): Promise<number>;
  getCounter(formId: string): Promise<number | null>;
  setCounter(formId: string, lastNumber: number): Promise<void>;
}

export const REF_SOURCE = 'cognito';
export const refEntity = (slug: string) => `entry:${slug}`;
