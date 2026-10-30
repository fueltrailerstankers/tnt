'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { loadForm } from '@/lib/forms/forms';
import { slugFromName, slugProblem } from '@/lib/forms/builder/names';
import { createForm, orgSlugs } from '@/lib/forms/builder/service';
import { blankSpec, duplicateSpec, importSpec } from '@/lib/forms/builder/spec';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export interface CreateState {
  problems?: string[];
  at?: number;
}

const MAX_IMPORT = 1024 * 1024;

const Input = z.object({
  how: z.enum(['blank', 'duplicate', 'import']),
  name: z.string().trim().min(1, 'Enter a name.').max(120),
  slug: z.string().trim().max(64),
  publicLink: z.boolean(),
  encrypt: z.boolean(),
  template: z.enum(['public-submit', 'internal-only']),
  source: z.string().max(64),
});

/** Create form: blank, duplicate (spec only, no entries) or import a FormSpec JSON. forms.manage only. */
export async function createFormAction(_: CreateState, fd: FormData): Promise<CreateState> {
  const member = await requirePerm('forms.manage');
  const parsed = Input.safeParse({
    how: fd.get('how'), name: fd.get('name') ?? '', slug: fd.get('slug') ?? '', publicLink: fd.get('publicLink') === 'on',
    encrypt: fd.get('encrypt') === 'on', template: fd.get('template') ?? 'public-submit', source: fd.get('source') ?? '',
  });
  const fail = (problems: string[]): CreateState => ({ problems, at: Date.now() });
  if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message));
  const p = parsed.data;
  const db = createAdminClient();
  const taken = await orgSlugs(db, member.orgId);
  const slug = p.slug || slugFromName(p.name, taken);
  const bad = slugProblem(slug, taken);
  if (bad) return fail([bad]);

  let spec;
  let sourceFormId: string | undefined;
  if (p.how === 'blank') {
    spec = blankSpec({ name: p.name, slug, encrypt: p.encrypt, template: p.template });
  } else if (p.how === 'duplicate') {
    // Read the source through the caller's RLS client: another org's form is simply not found.
    const src = /^[a-z0-9-]{1,64}$/.test(p.source) ? await loadForm(await createClient(), member.orgId, p.source) : null;
    if (!src) return fail(['Choose a form to duplicate.']);
    sourceFormId = src.id;
    spec = duplicateSpec(src.spec, { name: p.name, slug });
  } else {
    const file = fd.get('file');
    const text = file instanceof File && file.size ? (file.size > MAX_IMPORT ? null : await file.text()) : String(fd.get('json') ?? '');
    if (text === null) return fail(['The file is larger than 1 MB.']);
    if (!text.trim()) return fail(['Choose a FormSpec JSON file to import.']);
    const r = importSpec(text, { slug, name: p.name });
    if ('errors' in r) return fail(r.errors);
    spec = r.spec;
  }
  const created = await createForm(db, member, spec, { isActive: p.publicLink, how: p.how, sourceFormId });
  if (!created.ok) return fail(created.problems);
  redirect(`/admin/forms/${created.slug}/design?created=1`);
}
