import Link from 'next/link';
import { loadForms } from '@/lib/forms/forms';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { NewFormClient } from './NewFormClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New form · Trailers & Tankers' };

export default async function NewFormPage() {
  const member = await requirePerm('forms.manage');
  const forms = (await loadForms(await createClient(), member.orgId)).filter((f) => !f.archivedAt).map((f) => ({ slug: f.slug, name: f.spec.name }));
  return (
    <section className="space-y-5">
      <p className="text-small text-fg-muted"><Link href="/admin/forms" className="underline">Forms</Link> / New form</p>
      <h1 className="text-h1">New form</h1>
      <NewFormClient forms={forms} />
    </section>
  );
}
