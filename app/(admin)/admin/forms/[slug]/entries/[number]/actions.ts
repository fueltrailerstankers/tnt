'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { SubmitState } from '@/components/form-engine/types';
import type { RevealResult } from '@/components/ui/ProtectedField';
import { adminForm } from '@/lib/admin/context';
import { canReveal, keepStoredProtected, protectedNames, revealAuditRow, RevealInput } from '@/lib/entry-view/protected';
import { loadEntryByNumber } from '@/lib/forms/entries';
import { ENTRY_BUCKET, signedUrl } from '@/lib/forms/storage';
import { runAction } from '@/lib/workflow/run-action';

// Entry page actions. Each starts with adminForm (requirePerm + the form read through the caller's RLS) and
// validates its input with Zod; entries are read through the caller's RLS client before the service role is used.

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const EntryNo = z.number().int().positive();
const FileId = z.string().uuid();

export type PreviewResult = { ok: true; url: string } | { ok: false; message: string };

/**
 * Admins only: the clear value of one protected field. Writes an `entry.reveal` audit row (ids and the field key,
 * never the value) before returning it, and refuses if the row cannot be written.
 */
export async function revealProtectedField(slug: string, number: number, field: string): Promise<RevealResult> {
  const parsed = RevealInput.safeParse({ slug, number, field });
  if (!parsed.success) return { ok: false, message: 'Could not reveal the value.' };
  const { member, userDb, db, form } = await adminForm(parsed.data.slug, 'entries.read');
  if (!canReveal(member)) return { ok: false, message: 'Only an admin can reveal protected values.' };
  if (!protectedNames(form.spec).includes(parsed.data.field)) return { ok: false, message: 'This field is not protected.' };
  const entry = await loadEntryByNumber(userDb, form, parsed.data.number);
  if (!entry) return { ok: false, message: 'Entry not found.' };
  const { error } = await db.from('audit_log').insert(revealAuditRow(member, entry.id, form.slug, [parsed.data.field]));
  if (error) return { ok: false, message: 'Could not record the reveal, so the value stays hidden.' };
  const v = entry.data[parsed.data.field];
  return { ok: true, value: typeof v === 'string' ? v : '' };
}

/** A 60-second signed link to one file or signature of this entry (handoff rule 8). */
export async function previewEntryFile(slug: string, number: number, fileId: string): Promise<PreviewResult> {
  const input = z.object({ slug: Slug, number: EntryNo, fileId: FileId }).safeParse({ slug, number, fileId });
  if (!input.success) return { ok: false, message: 'File not found.' };
  const { userDb, db, form } = await adminForm(input.data.slug, 'entries.read');
  const entry = await loadEntryByNumber(userDb, form, input.data.number);
  if (!entry) return { ok: false, message: 'Entry not found.' };
  // Through the caller's RLS: the file must belong to this entry.
  const { data: file } = await userDb.from('entry_files').select('id, storage_path, kind').eq('id', input.data.fileId).eq('entry_id', entry.id).maybeSingle();
  if (!file || (file.kind !== 'file' && file.kind !== 'signature')) return { ok: false, message: 'File not found.' };
  const url = await signedUrl(db, ENTRY_BUCKET, file.storage_path as string);
  return url ? { ok: true, url } : { ok: false, message: 'Could not create a preview link. Try again.' };
}

/**
 * Save from the entry page of a form with protected fields. Same as the shared staff save (runAction does the role,
 * allowedWhen and permission checks), except that protected fields always keep the stored value: the page never
 * holds it, so whatever is posted for them is replaced before runAction reads the post.
 */
export async function saveEntryKeepingProtected(slug: string, number: number, _prev: SubmitState, fd: FormData): Promise<SubmitState> {
  const input = z.object({ slug: Slug, number: EntryNo }).safeParse({ slug, number });
  if (!input.success) return { message: 'Entry not found.', at: Date.now() };
  const { member, db, form } = await adminForm(input.data.slug, 'admin.access');
  if (fd.get('__uploading')) return { message: 'Wait for the uploads to finish, then save again.', at: Date.now() };
  const entry = await loadEntryByNumber(db, form, input.data.number);
  if (!entry || entry.orgId !== member.orgId) return { message: 'Entry not found.', at: Date.now() };
  keepStoredProtected(form.spec, fd, entry.data);
  const res = await runAction({
    db, form, entry, actionName: String(fd.get('__action') ?? ''), fd,
    actor: { kind: 'staff', member },
    expectedUpdatedAt: String(fd.get('__version') ?? '') || null,
  });
  if (!res.ok) return { message: res.message, errors: res.errors, at: Date.now() };
  revalidatePath(`/admin/forms/${form.slug}`);
  redirect(`/admin/forms/${form.slug}/entries/${res.number}?saved=${encodeURIComponent(res.status)}`);
}
