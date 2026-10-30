import 'server-only';
import { renderToBuffer } from '@react-pdf/renderer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { customerPanel } from '@/lib/forms/lookup';
import type { EntryRecord } from '@/lib/forms/entries';
import { loadFiles } from '@/lib/forms/entries';
import type { FormRecord } from '@/lib/forms/forms';
import { DOCS_BUCKET, downloadObject, ENTRY_BUCKET } from '@/lib/forms/storage';
import { decrypt, encrypt, parseKey, sha256Hex } from '@/lib/security/crypto';
import { CollectionSheetPdf, DealSheetPdf } from './DealPdf';
import { EntryPdf } from './EntryPdf';

// Generated PDFs are stored once per version in the private 'documents' bucket with a sha256 hash.
// A version is reused until the entry changes; then a new version is added and the old one kept.
// The signed Delivery Note is therefore never regenerated silently.

export interface DocumentTemplate {
  number: number;
  label: string;
}

/** Templates we can produce per form. #2 (Cognito's fillable "edit" PDF) is not reproduced. */
export function templatesFor(form: FormRecord): DocumentTemplate[] {
  const t: DocumentTemplate[] = [{ number: 1, label: 'Entry PDF' }];
  if (form.slug === 'deal') t.push({ number: 3, label: 'DEAL (Cognito template)' }, { number: 4, label: 'Collection sheet (provisional)' });
  return t;
}

/** Forms whose document #1 is a signed customer record, generated on every saving action. */
export const SIGNED_DOCUMENT_FORMS = new Set(['delivery-note']);

export interface StoredDocument {
  id: string;
  name: string;
  path: string;
  bytes: Buffer;
  sha256: string;
}

export function documentName(form: FormRecord, entry: Pick<EntryRecord, 'number'>, template: number): string {
  const base = form.spec.name.replace(/\s*,\s*/g, ' ').trim();
  const prefix = template === 3 ? 'DEAL' : template === 4 ? 'COLLECTION - DEAL' : base;
  return `${prefix} - ${entry.number}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
}

async function render(db: SupabaseClient, form: FormRecord, entry: EntryRecord, template: number, timezone: string): Promise<Buffer> {
  const generatedAt = new Date().toISOString();
  if (template === 3 || template === 4) {
    const Doc = template === 3 ? DealSheetPdf : CollectionSheetPdf;
    return renderToBuffer(<Doc entryNumber={entry.number} data={entry.data} timezone={timezone} generatedAt={generatedAt} />);
  }
  const files = await loadFiles(db, entry.id);
  const names: Record<string, string[]> = {};
  const signatures: Record<string, Buffer> = {};
  const signedBy: Record<string, { at: string; role: string }> = {};
  let termsVersionId: string | null = null;
  for (const f of files) {
    if (f.kind === 'signature') {
      const b = await downloadObject(db, ENTRY_BUCKET, f.storagePath);
      if (b) signatures[f.fieldKey] = b;
      if (f.signedAt && f.signerRole) signedBy[f.fieldKey] = { at: f.signedAt, role: f.signerRole };
      termsVersionId ??= f.termsVersionId ?? null;
    } else {
      (names[f.fieldKey] ??= []).push(f.fileName);
    }
  }
  const lookup = form.spec.fields.find((f) => f.type === 'lookup');
  const lookupId = lookup && 'name' in lookup ? (entry.data[lookup.name] as string | undefined) : undefined;
  const panel = lookup && lookup.type === 'lookup' && lookupId ? await customerPanel(db, form.orgId, lookup.lookup.sourceForm, lookupId, false) : undefined;
  const { data: tv } = termsVersionId ? await db.from('terms_versions').select('sha256').eq('id', termsVersionId).maybeSingle() : { data: null };
  return renderToBuffer(
    <EntryPdf
      spec={form.spec}
      title={documentName(form, entry, 1).replace(/\.pdf$/, '')}
      entry={{ number: entry.number, status: entry.status, createdAt: entry.createdAt, updatedAt: entry.updatedAt }}
      data={entry.data}
      files={names}
      signatures={signatures}
      signedBy={signedBy}
      termsVersion={tv ? { sha256: tv.sha256 as string } : null}
      lookupPanel={panel}
      timezone={timezone}
      generatedAt={generatedAt}
    />,
  );
}

// Encrypted forms (DEAL, Delivery Note): the stored PDF holds the same personal data as the entry, so it is
// encrypted too (AES-256-GCM with ENTRY_ENCRYPTION_KEY, AAD = storage path). sha256 is over the plain PDF.
function docKey(): Buffer {
  return parseKey(process.env.ENTRY_ENCRYPTION_KEY, 'ENTRY_ENCRYPTION_KEY');
}

/** Reads a stored version and checks its hash. Null when missing or tampered with. */
export async function readStoredDocument(db: SupabaseClient, form: FormRecord, path: string, sha256: string): Promise<Buffer | null> {
  const raw = await downloadObject(db, DOCS_BUCKET, path);
  if (!raw) return null;
  let bytes: Buffer;
  try {
    bytes = form.encrypt ? decrypt(raw, docKey(), path) : raw;
  } catch {
    return null;
  }
  return sha256Hex(bytes) === sha256 ? bytes : null;
}

/** Returns the current version of a document, generating and storing a new one if the entry changed since. */
export async function ensureDocument(
  db: SupabaseClient, form: FormRecord, entry: EntryRecord, template: number, timezone: string, actorUserId: string | null,
): Promise<StoredDocument> {
  if (!templatesFor(form).some((t) => t.number === template)) throw new Error('Unknown document');
  const { data: latest } = await db
    .from('entry_documents')
    .select('id, storage_path, name, sha256, created_at')
    .eq('entry_id', entry.id)
    .eq('template_number', template)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest && new Date(latest.created_at) >= new Date(entry.updatedAt)) {
    const bytes = await readStoredDocument(db, form, latest.storage_path, latest.sha256);
    if (bytes) {
      return { id: latest.id, name: latest.name, path: latest.storage_path, bytes, sha256: latest.sha256 };
    }
  }
  const bytes = await render(db, form, entry, template, timezone);
  const sha = sha256Hex(bytes);
  const name = documentName(form, entry, template);
  const path = `${form.slug}/${entry.id}/${template}-${Date.now()}-${sha.slice(0, 12)}.pdf`;
  const stored = form.encrypt ? encrypt(bytes, docKey(), path) : bytes;
  const up = await db.storage.from(DOCS_BUCKET).upload(path, stored, { contentType: form.encrypt ? 'application/octet-stream' : 'application/pdf', upsert: false });
  if (up.error) throw new Error('Could not store the document');
  const { data: row, error } = await db
    .from('entry_documents')
    .insert({ entry_id: entry.id, template_number: template, storage_path: path, name, sha256: sha, size_bytes: bytes.length, created_by: actorUserId })
    .select('id')
    .single();
  if (error) throw new Error('Could not record the document');
  return { id: row.id, name, path, bytes, sha256: sha };
}
