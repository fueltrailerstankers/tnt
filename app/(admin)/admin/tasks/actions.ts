'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminForm } from '@/lib/admin/context';
import { loadEntryById, loadFiles } from '@/lib/forms/entries';
import { requirePerm } from '@/lib/security/require';
import { INSPECTION_ACTIONS, INSPECTION_SLUG, type TaskActionResult } from '@/lib/tasks/build';
import { carryFormData } from '@/lib/tasks/carry';
import { runAction } from '@/lib/workflow/run-action';

// One-click inspection steps from /admin/tasks. Permission first (requirePerm, then adminForm with the step's own
// permission), Zod on the input, then runAction: the same save path as the entry page, which re-checks the role,
// allowedWhen, the per-action permission and the version, and sends the spec's emails. The entry's own values and
// files are carried unchanged (lib/tasks/carry.ts); if they cannot be carried exactly, nothing is saved.

const Input = z.object({
  kind: z.enum(['review', 'approve']),
  entryId: z.guid(),
  version: z.string().min(10).max(64),
});

const STEP = {
  review: { perm: 'entries.review', status: 'Submitted', action: INSPECTION_ACTIONS.Submitted, done: 'marked reviewed', verb: 'review' },
  approve: { perm: 'entries.approve', status: 'Reviewed', action: INSPECTION_ACTIONS.Reviewed, done: 'approved', verb: 'approve' },
} as const;

export async function inspectionTaskAction(input: unknown): Promise<TaskActionResult> {
  await requirePerm('tasks.read');
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'This task could not be read. Reload the page and try again.' };
  const { kind, entryId, version } = parsed.data;
  const step = STEP[kind];
  const { member, db, form } = await adminForm(INSPECTION_SLUG, step.perm);

  // The form was loaded through the caller's RLS client, so this entry is in their org.
  const entry = await loadEntryById(db, form, entryId);
  if (!entry) return { ok: false, message: 'This entry no longer exists.' };
  const href = `/admin/forms/${form.slug}/entries/${entry.number}`;
  if (entry.status !== step.status || entry.updatedAt !== version) {
    return { ok: false, message: 'This entry was changed by someone else. Reload it and try again.', href, linkLabel: 'Open entry' };
  }

  const carried = carryFormData(form.spec, entry.data, await loadFiles(db, entry.id));
  if (!carried.ok) return { ok: false, message: `Open the entry to ${step.verb} it.`, href, linkLabel: 'Open entry' };

  try {
    const res = await runAction({
      db, form, entry, actionName: step.action, fd: carried.fd, actor: { kind: 'staff', member }, expectedUpdatedAt: version,
    });
    if (!res.ok) {
      if (res.code === 400) return { ok: false, message: 'Open the entry to fix the highlighted fields.', href, linkLabel: 'Open entry' };
      return { ok: false, message: res.message, href, linkLabel: 'Open entry' };
    }
  } catch {
    return { ok: false, message: 'The entry could not be saved. Try again.', href, linkLabel: 'Open entry' };
  }

  revalidatePath('/admin/tasks');
  revalidatePath('/admin');
  revalidatePath(`/admin/forms/${form.slug}`);
  return { ok: true, message: `Inspection #${entry.number} ${step.done}` };
}
