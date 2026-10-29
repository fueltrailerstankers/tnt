import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExistingFile } from '@/components/form-engine/types';
import { loadFiles, type EntryRecord } from './entries';
import { ENTRY_BUCKET, signedUrl } from './storage';

/** Existing files and signatures of an entry for the renderer, with 60-second signed links. */
export async function rendererFiles(db: SupabaseClient, entry: EntryRecord, withLinks: boolean) {
  const files: Record<string, ExistingFile[]> = {};
  const signatures: Record<string, ExistingFile> = {};
  for (const f of await loadFiles(db, entry.id)) {
    const url = withLinks ? await signedUrl(db, ENTRY_BUCKET, f.storagePath, f.kind === 'file' ? f.fileName : undefined) : null;
    if (f.kind === 'signature') signatures[f.fieldKey] = { id: f.id, name: f.fileName, url };
    else if (f.kind === 'file') (files[f.fieldKey] ??= []).push({ id: f.id, name: f.fileName, url });
  }
  return { files, signatures };
}
