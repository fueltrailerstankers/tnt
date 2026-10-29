// In-memory ImportSink with the same uniqueness rules as the database: entries (form_id, number) and
// external_refs (org, source, entity, external_id). Used by tests and by offline dry-runs (no Supabase env).
// `failAfter` lets a test crash the importer after N writes to prove a re-run does not duplicate anything.
import type { FormRecord } from '@/lib/forms/forms';
import type { FormSpec } from '@/lib/spec/types';
import type { EntryEventInsert, EntryFileInsert, EntryInsert, EntryKey, ImportSink } from './sink';

export function formRecordFromSpec(spec: FormSpec, id: string, orgId: string): FormRecord {
  return {
    id, orgId, slug: spec.slug, name: spec.name, isActive: true,
    encrypt: spec.settings.encryptEntries === true, summaryTemplate: spec.settings.entrySummary, spec,
  };
}

export class MemorySink implements ImportSink {
  entries: EntryInsert[] = [];
  files: EntryFileInsert[] = [];
  events: EntryEventInsert[] = [];
  refs: Array<{ entity: string; external_id: string; internal_id: string }> = [];
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  counters = new Map<string, number>();
  writes = 0;
  failAfter: number | null = null;

  constructor(readonly orgId: string, private forms: FormRecord[]) {}

  private write() {
    if (this.failAfter !== null && this.writes >= this.failAfter) throw new Error('simulated crash');
    this.writes++;
  }

  async loadForms() {
    return this.forms;
  }
  async loadRefs(entity: string) {
    return new Map(this.refs.filter((r) => r.entity === entity).map((r) => [r.external_id, r.internal_id]));
  }
  async listEntryKeys(formId: string): Promise<EntryKey[]> {
    return this.entries.filter((e) => e.form_id === formId).map((e) => ({ id: e.id, number: e.number, cognito_entry_id: e.cognito_entry_id }));
  }
  async insertEntry(row: EntryInsert) {
    this.write();
    if (this.entries.some((e) => e.id === row.id || (e.form_id === row.form_id && e.number === row.number))) {
      throw new Error('duplicate key value violates unique constraint');
    }
    this.entries.push(structuredClone(row));
  }
  async listFilePaths(entryId: string) {
    return this.files.filter((f) => f.entry_id === entryId).map((f) => f.storage_path);
  }
  async upload(path: string, bytes: Uint8Array, contentType: string) {
    this.write();
    this.objects.set(path, { bytes, contentType });
  }
  async insertFile(row: EntryFileInsert) {
    this.write();
    this.files.push({ ...row });
  }
  async hasImportEvent(entryId: string) {
    return this.events.some((e) => e.entry_id === entryId && e.action === 'Import');
  }
  async insertEvent(row: EntryEventInsert) {
    this.write();
    this.events.push(structuredClone(row));
  }
  async insertRef(entity: string, externalId: string, internalId: string) {
    this.write();
    if (!this.refs.some((r) => r.entity === entity && r.external_id === externalId)) {
      this.refs.push({ entity, external_id: externalId, internal_id: internalId });
    }
  }
  async maxNumber(formId: string) {
    return this.entries.filter((e) => e.form_id === formId).reduce((m, e) => Math.max(m, e.number), 0);
  }
  async getCounter(formId: string) {
    return this.counters.get(formId) ?? null;
  }
  async setCounter(formId: string, lastNumber: number) {
    this.write();
    this.counters.set(formId, lastNumber);
  }
}
