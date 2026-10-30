'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { SubmitState, UploadTicket } from '@/components/form-engine/types';
import { appEnv } from '@/lib/env';
import { loadForm } from '@/lib/forms/forms';
import { customerPanel, lookupExact } from '@/lib/forms/lookup';
import { checkableQuoteNo, quoteFieldOf } from '@/lib/forms/quote-fields';
import { issueUploads } from '@/lib/forms/storage';
import { publicLookupOf, publicUploadAllowed } from '@/lib/forms/public-policy';
import { validateUploadRequest } from '@/lib/forms/uploads';
import { clientIp, rateLimit } from '@/lib/security/rate-limit';
import { TURNSTILE_FIELD, verifyTurnstile } from '@/lib/security/turnstile';
import { createAdminClient } from '@/lib/supabase/admin';
import { runAction } from '@/lib/workflow/run-action';
import type { LookupOption } from '@/lib/forms/lookup-types';

// Public /f/<slug> actions. No user: the form must be active, the action must be one the spec's public
// role may run on a new entry, and every call is rate limited per client. Service role is used only here,
// after those checks.

async function publicForm(slug: string) {
  const db = createAdminClient();
  const form = await loadForm(db, appEnv().PUBLIC_ORG_ID, slug);
  return form && form.isActive ? { db, form } : null;
}

async function limited(kind: string, limit: number): Promise<boolean> {
  return !rateLimit(`${kind}:${clientIp(await headers())}`, limit, 60_000);
}

export async function submitPublic(slug: string, _prev: SubmitState, fd: FormData): Promise<SubmitState> {
  if (await limited('submit', 20)) return { message: 'Too many submissions. Wait a minute and try again.', at: Date.now() };
  // Honeypot: bots fill every field. Pretend success, store nothing.
  if (typeof fd.get('__hp') === 'string' && fd.get('__hp') !== '') redirect(`/f/${slug}/thanks`);
  if (fd.get('__uploading')) return { message: 'Wait for the uploads to finish, then submit again.', at: Date.now() };
  const secret = appEnv().TURNSTILE_SECRET_KEY;
  if (secret && !(await verifyTurnstile(fd.get(TURNSTILE_FIELD), clientIp(await headers()), secret))) {
    return { message: 'Complete the security check above the Submit button, then submit again.', at: Date.now() };
  }

  const ctx = await publicForm(slug);
  if (!ctx) return { message: 'This form is not available.', at: Date.now() };
  const actionName = String(fd.get('__action') ?? '');
  const res = await runAction({ db: ctx.db, form: ctx.form, entry: null, actionName, actor: { kind: 'public' }, fd });
  if (!res.ok) return { message: res.message, errors: res.errors, at: Date.now() };
  redirect(`/f/${slug}/thanks?a=${encodeURIComponent(actionName)}`);
}

export async function requestUploadPublic(slug: string, field: string, files: Array<{ name: string; size: number; type: string }>): Promise<{ tickets?: UploadTicket[]; error?: string }> {
  if (await limited('upload', 30)) return { error: 'Too many uploads. Wait a minute and try again.' };
  const ctx = await publicForm(slug);
  if (!ctx) return { error: 'This form is not available.' };
  if (!publicUploadAllowed(ctx.form.spec, field)) return { error: 'Unknown file field.' };
  const v = validateUploadRequest(ctx.form.spec, field, files);
  if (!v.ok) return { error: v.error };
  return { tickets: await issueUploads(ctx.db, field, v.files) };
}

export async function findLookupPublic(slug: string, value: string): Promise<{ option: LookupOption; panel: Array<[string, string]> } | null> {
  if (await limited('lookup', 10)) return null;
  const ctx = await publicForm(slug);
  const field = ctx ? publicLookupOf(ctx.form.spec) : null; // allow-listed public lookups only (M8)
  if (!ctx || !field || typeof value !== 'string') return null;
  const hit = await lookupExact(ctx.db, ctx.form.orgId, field.lookup.sourceForm, field.lookup.displayField, value);
  if (!hit) return null;
  return { option: hit, panel: await customerPanel(ctx.db, ctx.form.orgId, field.lookup.sourceForm, hit.id, true) };
}

/**
 * Public quote check: only says whether the typed number exists in this form's org. Never returns the
 * quote list, customer names or amounts. Advisory only: submission never depends on it.
 */
export async function checkQuotePublic(slug: string, value: string): Promise<{ found: boolean }> {
  if (await limited('quote', 10)) return { found: false };
  const no = checkableQuoteNo(value);
  if (!no) return { found: false };
  const ctx = await publicForm(slug);
  if (!ctx || !quoteFieldOf(ctx.form.spec)) return { found: false };
  const { data } = await ctx.db.from('xero_quotes').select('id').eq('org_id', ctx.form.orgId).eq('quote_no', no).limit(1);
  return { found: !!data?.length };
}
