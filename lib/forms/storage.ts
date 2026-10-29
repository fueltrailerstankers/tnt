import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { displayFileName, isAllowed, safeObjectName, sniff, storedContentType } from '@/lib/security/files';
import { MAX_FILE_BYTES, MAX_SIGNATURE_BYTES, type FileRef } from '@/lib/spec/values';

// Uploads go browser -> Storage through short-lived signed upload URLs into staging/, so large files never
// pass through a serverless function. On save the server checks size and magic bytes, then moves the object
// under <form>/<entry>/<field>/. Nothing outside staging/ can be claimed by a submission.
export const ENTRY_BUCKET = 'entry-files';
export const DOCS_BUCKET = 'documents';
export const SIGNED_URL_SECONDS = 60;

export interface UploadRequest {
  name: string;
  size: number;
  type: string;
}
export interface IssuedUpload extends UploadRequest {
  path: string;
  token: string;
}

export async function issueUploads(db: SupabaseClient, field: string, files: UploadRequest[]): Promise<IssuedUpload[]> {
  const dir = `staging/${randomUUID()}/${field}`;
  const out: IssuedUpload[] = [];
  for (const f of files) {
    const path = `${dir}/${randomUUID()}-${safeObjectName(f.name)}`;
    const { data, error } = await db.storage.from(ENTRY_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error('Could not start upload');
    out.push({ ...f, name: displayFileName(f.name), path, token: data.token });
  }
  return out;
}

export type StagedCheck = { ok: true; contentType: string; size: number } | { ok: false; reason: string };

/** Size and magic-byte check of a staged object. Reads only the first bytes. */
export async function checkStaged(db: SupabaseClient, ref: Extract<FileRef, { kind: 'staged' }>, accept?: string): Promise<StagedCheck> {
  const bucket = db.storage.from(ENTRY_BUCKET);
  const info = await bucket.info(ref.path);
  if (info.error || !info.data) return { ok: false, reason: 'missing' };
  const size = Number(info.data.size ?? 0);
  if (!size || size > MAX_FILE_BYTES) return { ok: false, reason: 'size' };
  const signed = await bucket.createSignedUrl(ref.path, 30);
  if (signed.error || !signed.data) return { ok: false, reason: 'missing' };
  const res = await fetch(signed.data.signedUrl, { headers: { Range: 'bytes=0-63' } });
  if (!res.ok) return { ok: false, reason: 'missing' };
  const head = new Uint8Array(await res.arrayBuffer()).slice(0, 64);
  const t = sniff(head);
  if (!t || !isAllowed(t, accept)) return { ok: false, reason: 'type' };
  return { ok: true, contentType: storedContentType(t, ref.type), size };
}

export function finalPath(slug: string, entryId: string, field: string, name: string): string {
  return `${slug}/${entryId}/${field}/${randomUUID()}-${safeObjectName(name)}`;
}

export async function moveObject(db: SupabaseClient, from: string, to: string): Promise<void> {
  const { error } = await db.storage.from(ENTRY_BUCKET).move(from, to);
  if (error) throw new Error('Could not store the uploaded file');
}

/** Decodes a signature PNG data URL and stores it. Returns the stored byte size. */
export async function saveSignature(db: SupabaseClient, path: string, dataUrl: string): Promise<number> {
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  if (bytes.length > MAX_SIGNATURE_BYTES || sniff(bytes.subarray(0, 16)) !== 'image/png') throw new Error('Invalid signature image');
  const { error } = await db.storage.from(ENTRY_BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: false });
  if (error) throw new Error('Could not store the signature');
  return bytes.length;
}

export async function removeObjects(db: SupabaseClient, bucket: string, paths: string[]): Promise<void> {
  if (!paths.length) return;
  await db.storage.from(bucket).remove(paths);
}

export async function signedUrl(db: SupabaseClient, bucket: string, path: string, downloadName?: string): Promise<string | null> {
  const { data } = await db.storage.from(bucket).createSignedUrl(path, SIGNED_URL_SECONDS, downloadName ? { download: downloadName } : undefined);
  return data?.signedUrl ?? null;
}

export async function downloadObject(db: SupabaseClient, bucket: string, path: string): Promise<Buffer | null> {
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
