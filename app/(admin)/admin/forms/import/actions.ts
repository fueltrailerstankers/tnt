'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { drainImportJobs, resumeImport, startImport, stopImport, testConnection } from '@/lib/import/cognito/job';
import { removeApiKey, saveApiKey } from '@/lib/import/cognito/key';
import { errorText, ImportJobError } from '@/lib/import/cognito/progress';
import type { Member } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ActionState, ConnectionView } from './types';

// Cognito import (admin only: import.run). Every action checks the permission first, validates its input, and only
// then uses the service role. audit_log rows carry ids and codes only: never the key, its last characters or entry data.

const PAGE = '/admin/forms/import';

type Db = ReturnType<typeof createAdminClient>;

async function audit(db: Db, member: Member, action: string, entity: string, entityId: string, meta: Record<string, unknown> = {}) {
  await db.from('audit_log').insert({ org_id: member.orgId, actor_user: member.userId, action, entity, entity_id: entityId, meta });
}

/** Starts the first slice right away (after the response is sent) instead of waiting for the next scheduled drain. */
function kick() {
  after(async () => {
    try {
      await drainImportJobs(createAdminClient(), 45_000);
    } catch {
      // The scheduled drain picks the job up; nothing from here is logged (it could only be a redacted status).
    }
  });
}

const keySchema = z.object({ key: z.string().trim().min(8, 'short').max(4096, 'long').regex(/^\S+$/, 'spaces') });

export async function saveKeyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const member = await requirePerm('import.run');
  const parsed = keySchema.safeParse({ key: fd.get('key') ?? '' });
  if (!parsed.success) return { error: 'Paste the whole API key from Cognito (at least 8 characters, no spaces).' };
  const db = createAdminClient();
  try {
    await saveApiKey(db, member.orgId, parsed.data.key, member.userId);
  } catch (e) {
    return { error: e instanceof ImportJobError ? errorText(e.code) : 'The key could not be saved. Try again.' };
  }
  await audit(db, member, 'cognito.key.save', 'org', member.orgId);
  revalidatePath(PAGE);
  return { ok: 'Key saved. It is stored encrypted and will not be shown again.' };
}

export async function removeKeyAction(_prev: ActionState): Promise<ActionState> {
  void _prev;
  const member = await requirePerm('import.run');
  const db = createAdminClient();
  const removed = await removeApiKey(db, member.orgId);
  if (removed) await audit(db, member, 'cognito.key.remove', 'org', member.orgId);
  revalidatePath(PAGE);
  return { ok: removed ? 'Key removed.' : 'No key was saved.' };
}

export async function testConnectionAction(_prev: ConnectionView | null): Promise<ConnectionView> {
  void _prev;
  const member = await requirePerm('import.run');
  const db = createAdminClient();
  const r = await testConnection(db, member.orgId);
  await audit(db, member, 'cognito.test_connection', 'org', member.orgId, r.ok ? { ok: true, forms: r.forms.length } : { ok: false, error: r.error });
  if (!r.ok) return { ok: false, error: errorText(r.error), at: new Date().toISOString() };
  return {
    ok: true,
    at: new Date().toISOString(),
    entryAccess: r.entryAccess,
    forms: r.forms.map((f) => ({
      cognitoId: f.cognito.id, name: f.cognito.name, entries: f.cognito.entryCount,
      platform: f.platform ? { slug: f.platform.slug, name: f.platform.name, expected: f.platform.expected } : null,
    })),
    missing: r.missing.map((m) => ({ slug: m.slug, name: m.name })),
  };
}

const startSchema = z.object({
  form: z.union([z.literal('all'), z.string().regex(/^[a-z0-9-]{1,64}$/)]),
  mode: z.enum(['dry_run', 'apply']),
  limit: z.union([z.literal(''), z.coerce.number().int().positive().max(1_000_000)]).optional(),
});

export async function startRunAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const member = await requirePerm('import.run');
  const parsed = startSchema.safeParse({ form: fd.get('form'), mode: fd.get('mode'), limit: fd.get('limit') ?? undefined });
  if (!parsed.success) return { error: 'Choose a form and enter the limit as a whole number (or leave it empty).' };
  const { form, mode } = parsed.data;
  const limit = typeof parsed.data.limit === 'number' ? parsed.data.limit : undefined;
  const db = createAdminClient();
  const r = await startImport(db, member, { form, mode, limit });
  if (!r.ok) return { error: r.error };
  await audit(db, member, 'cognito.import.start', 'import_run', r.runIds[0], { form, mode, runs: r.runIds.length, ...(limit ? { limit } : {}) });
  kick();
  revalidatePath(PAGE);
  return { ok: mode === 'apply' ? 'Import started.' : 'Dry run started.' };
}

const controlSchema = z.object({ run: z.string().uuid(), op: z.enum(['stop', 'resume']) });

/** Stop or Resume a run (for "All forms": the whole set). */
export async function runControlAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const member = await requirePerm('import.run');
  const parsed = controlSchema.safeParse({ run: fd.get('run'), op: fd.get('op') });
  if (!parsed.success) return { error: 'Run not found.' };
  const { run, op } = parsed.data;
  const db = createAdminClient();
  const r = op === 'stop' ? await stopImport(db, member.orgId, run) : await resumeImport(db, member, run);
  if (!r.ok) return { error: r.error };
  await audit(db, member, `cognito.import.${op}`, 'import_run', run, { runs: r.runIds.length });
  if (op === 'resume') kick();
  revalidatePath(PAGE);
  return { ok: op === 'stop' ? 'Stopping. A running step pauses within a few seconds.' : 'Resumed.' };
}
