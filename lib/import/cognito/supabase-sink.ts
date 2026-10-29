// ImportSink over the service-role Supabase client. Used only by scripts/import-cognito.ts (an operator-run
// script, not a request path), so there is no user and no requirePerm: access is the service-role key itself.
// Error messages are reduced to the table/operation name so no value (file name, path) reaches the console.
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll } from '@/lib/db/paging';
import { loadForms } from '@/lib/forms/forms';
import { ENTRY_BUCKET } from '@/lib/forms/storage';
import { REF_SOURCE, type EntryEventInsert, type EntryFileInsert, type EntryInsert, type EntryKey, type ImportSink } from './sink';

function check(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what} failed`);
}

export class SupabaseSink implements ImportSink {
  constructor(private readonly db: SupabaseClient, readonly orgId: string) {}

  loadForms() {
    return loadForms(this.db, this.orgId);
  }

  async loadRefs(entity: string): Promise<Map<string, string>> {
    const rows = await fetchAll<{ external_id: string; internal_id: string }>((a, b) =>
      this.db.from('external_refs').select('external_id, internal_id')
        .eq('org_id', this.orgId).eq('source', REF_SOURCE).eq('entity', entity).order('external_id').range(a, b));
    return new Map(rows.map((r) => [r.external_id, r.internal_id]));
  }

  listEntryKeys(formId: string): Promise<EntryKey[]> {
    return fetchAll<EntryKey>((a, b) => this.db.from('entries').select('id, number, cognito_entry_id').eq('form_id', formId).order('number').range(a, b));
  }

  async insertEntry(row: EntryInsert) {
    const { error } = await this.db.from('entries').insert(row);
    check('entries insert', error);
  }

  async listFilePaths(entryId: string) {
    const { data, error } = await this.db.from('entry_files').select('storage_path').eq('entry_id', entryId);
    check('entry_files read', error);
    return (data ?? []).map((r) => r.storage_path as string);
  }

  async upload(path: string, bytes: Uint8Array, contentType: string) {
    const { error } = await this.db.storage.from(ENTRY_BUCKET).upload(path, bytes, { contentType, upsert: true });
    check('storage upload', error);
  }

  async insertFile(row: EntryFileInsert) {
    const { error } = await this.db.from('entry_files').insert(row);
    check('entry_files insert', error);
  }

  async hasImportEvent(entryId: string) {
    const { data, error } = await this.db.from('entry_events').select('id').eq('entry_id', entryId).eq('action', 'Import').limit(1);
    check('entry_events read', error);
    return (data ?? []).length > 0;
  }

  async insertEvent(row: EntryEventInsert) {
    const { error } = await this.db.from('entry_events').insert(row);
    check('entry_events insert', error);
  }

  async insertRef(entity: string, externalId: string, internalId: string) {
    const { error } = await this.db.from('external_refs').upsert(
      { org_id: this.orgId, source: REF_SOURCE, entity, external_id: externalId, internal_id: internalId },
      { onConflict: 'org_id,source,entity,external_id', ignoreDuplicates: true },
    );
    check('external_refs insert', error);
  }

  async maxNumber(formId: string) {
    const { data, error } = await this.db.from('entries').select('number').eq('form_id', formId).order('number', { ascending: false }).limit(1);
    check('entries read', error);
    return (data?.[0]?.number as number | undefined) ?? 0;
  }

  async getCounter(formId: string) {
    const { data, error } = await this.db.from('form_counters').select('last_number').eq('form_id', formId).maybeSingle();
    check('form_counters read', error);
    return (data?.last_number as number | undefined) ?? null;
  }

  async setCounter(formId: string, lastNumber: number) {
    // org_id is overwritten from the form by the tg_org_from_parent trigger.
    const { error } = await this.db.from('form_counters').upsert({ form_id: formId, org_id: this.orgId, last_number: lastNumber }, { onConflict: 'form_id' });
    check('form_counters update', error);
  }
}
