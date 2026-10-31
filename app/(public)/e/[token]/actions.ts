'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { SubmitState, UploadTicket } from '@/components/form-engine/types';
import { loadEntryById } from '@/lib/forms/entries';
import { customerPanel, lookupExact } from '@/lib/forms/lookup';
import type { LookupOption } from '@/lib/forms/lookup-types';
import { issueUploads } from '@/lib/forms/storage';
import { publicLookupOf, publicUploadAllowed } from '@/lib/forms/public-policy';
import { validateUploadRequest } from '@/lib/forms/uploads';
import { clientIp, rateLimit } from '@/lib/security/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveRoleLink } from '@/lib/workflow/links';
import { runAction } from '@/lib/workflow/run-action';
import { loadFormById } from '@/lib/forms/forms';

// Role-link actions. The token is the credential: it is re-resolved (hash lookup, expiry, revocation)
// on every call and only grants the link's own entry and public role.

async function context(token: string) {
  const db = createAdminClient();
  const link = await resolveRoleLink(db, token);
  if (!link) return null;
  const { data } = await db.from('entries').select('form_id').eq('id', link.entryId).maybeSingle();
  if (!data) return null;
  const form = await loadFormById(db, data.form_id);
  if (!form || !form.isActive) return null;
  const entry = await loadEntryById(db, form, link.entryId);
  return entry ? { db, link, form, entry } : null;
}

async function limited(kind: string, limit: number) {
  return !rateLimit(`link-${kind}:${clientIp(await headers())}`, limit, 60_000);
}

export async function submitLink(token: string, _prev: SubmitState, fd: FormData): Promise<SubmitState> {
  if (await limited('submit', 20)) return { message: 'Too many requests. Wait a minute and try again.', at: Date.now() };
  if (fd.get('__uploading')) return { message: 'Wait for the uploads to finish, then submit again.', at: Date.now() };
  const ctx = await context(token);
  if (!ctx) return { message: 'This link has expired or is no longer valid.', at: Date.now() };
  const actionName = String(fd.get('__action') ?? '');
  const res = await runAction({
    db: ctx.db, form: ctx.form, entry: ctx.entry, actionName, fd,
    actor: { kind: 'link', roleName: ctx.link.roleName, entryId: ctx.entry.id },
    expectedUpdatedAt: String(fd.get('__version') ?? '') || null,
  });
  if (!res.ok) return { message: res.message, errors: res.errors, at: Date.now() };
  redirect(`/f/${ctx.form.slug}/thanks?a=${encodeURIComponent(actionName)}`);
}

export async function requestUploadLink(token: string, field: string, files: Array<{ name: string; size: number; type: string }>): Promise<{ tickets?: UploadTicket[]; error?: string }> {
  if (await limited('upload', 30)) return { error: 'Too many uploads. Wait a minute and try again.' };
  const ctx = await context(token);
  if (!ctx) return { error: 'This link has expired or is no longer valid.' };
  if (!publicUploadAllowed(ctx.form.spec, field)) return { error: 'Unknown file field.' };
  const v = validateUploadRequest(ctx.form.spec, field, files);
  if (!v.ok) return { error: v.error };
  return { tickets: await issueUploads(ctx.db, field, v.files) };
}

export async function findLookupLink(token: string, value: string): Promise<{ option: LookupOption; panel: Array<[string, string]> } | null> {
  if (await limited('lookup', 10)) return null;
  const ctx = await context(token);
  const field = ctx ? publicLookupOf(ctx.form.spec) : null; // allow-listed public lookups only (M8)
  if (!ctx || !field || typeof value !== 'string') return null;
  const hit = await lookupExact(ctx.db, ctx.form.orgId, field.lookup.sourceForm, field.lookup.displayField, value);
  return hit ? { option: hit, panel: await customerPanel(ctx.db, ctx.form.orgId, field.lookup.sourceForm, hit.id, true) } : null;
}
