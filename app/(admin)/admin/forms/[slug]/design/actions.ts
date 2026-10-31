'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { adminForm } from '@/lib/admin/context';
import { archiveForm, discardDraft, publish, restoreAsDraft, saveDraft } from '@/lib/forms/builder/service';

export interface DesignResult {
  ok: boolean;
  problems?: string[];
  version?: number;
}

const Json = z.string().max(1024 * 1024);
const Note = z.string().trim().max(500);

function parseDraft(json: string): unknown {
  try {
    return JSON.parse(Json.parse(json));
  } catch {
    return null;
  }
}

/** Saves the draft (any shape; publish checks it). forms.manage. */
export async function saveDraftAction(slug: string, json: string): Promise<DesignResult> {
  const { db, form } = await adminForm(slug, 'forms.manage');
  const draft = parseDraft(json);
  if (!draft || typeof draft !== 'object') return { ok: false, problems: ['The draft could not be read.'] };
  await saveDraft(db, form, draft);
  return { ok: true };
}

/** Publishes the draft: parseSpec + builder rules + data guards; version + 1; audited form.publish. */
export async function publishAction(slug: string, json: string, note: string): Promise<DesignResult> {
  const { member, userDb, db, form } = await adminForm(slug, 'forms.manage');
  const draft = parseDraft(json);
  if (!draft) return { ok: false, problems: ['The draft could not be read.'] };
  const n = Note.safeParse(note);
  const r = await publish(db, userDb, member, form, draft, n.success ? n.data : null);
  if (!r.ok) {
    await saveDraft(db, form, draft); // keep the work; the guards explain what to change
    return { ok: false, problems: r.problems };
  }
  revalidatePath(`/admin/forms/${slug}`);
  return { ok: true, version: r.version };
}

export async function discardDraftAction(slug: string): Promise<DesignResult> {
  const { db, form } = await adminForm(slug, 'forms.manage');
  await discardDraft(db, form);
  return { ok: true };
}

export async function restoreVersionAction(slug: string, version: number): Promise<DesignResult> {
  const { member, db, form } = await adminForm(slug, 'forms.manage');
  const v = z.number().int().min(1).max(100000).safeParse(version);
  if (!v.success) return { ok: false, problems: ['Unknown version.'] };
  return restoreAsDraft(db, member, form, v.data);
}

/** Archive: typed slug confirmation; entries are kept. */
export async function archiveFormAction(slug: string, fd: FormData): Promise<void> {
  const { member, db, form } = await adminForm(slug, 'forms.manage');
  if (String(fd.get('confirm') ?? '').trim() !== slug) redirect(`/admin/forms/${slug}/design?tab=history&archive=confirm`);
  await archiveForm(db, member, form);
  revalidatePath('/admin/forms');
  redirect('/admin/forms?archived=1');
}
