import Link from 'next/link';
import { Designer } from '@/components/form-builder/Designer';
import { adminForm } from '@/lib/admin/context';
import { formatDateTime } from '@/lib/admin/grid';
import { publicEnv } from '@/lib/env';
import { loadForms } from '@/lib/forms/forms';
import { dataContext } from '@/lib/forms/builder/service';
import { FormSpec, inputFields } from '@/lib/spec/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Design form · Trailers & Tankers' };

type Tab = 'fields' | 'workflow' | 'documents' | 'settings' | 'history';
const TABS: Tab[] = ['fields', 'workflow', 'documents', 'settings', 'history'];

/** Form designer. forms.manage only (adminForm refuses everyone else on the server). */
export default async function DesignPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string; created?: string; restored?: string; archive?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { member, userDb, form, org } = await adminForm(slug, 'forms.manage');
  const ctx = await dataContext(userDb, form);
  const { data: versions } = await userDb.from('form_versions').select('version, note, created_at').eq('form_id', form.id).order('version', { ascending: false });
  const others = (await loadForms(userDb, member.orgId)).filter((f) => !f.archivedAt);
  // A saved draft that no longer parses (e.g. half-typed rule) still opens: the designer shows what to fix.
  const parsedDraft = form.draftSpec ? FormSpec.safeParse(form.draftSpec) : null;
  const draft = (form.draftSpec ? (parsedDraft?.success ? parsedDraft.data : form.draftSpec) : form.spec) as FormSpec;
  const env = publicEnv();
  const tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'fields';
  const flash = sp.created ? 'Form created. Add fields, then Publish.' : sp.restored ? `Version ${sp.restored} restored as the draft. Publish to use it.` : sp.archive ? 'Type the slug to archive the form.' : undefined;

  return (
    <section className="space-y-4">
      <p className="text-small text-fg-muted">
        <Link href="/admin/forms" className="underline">Forms</Link> / <Link href={`/admin/forms/${slug}`} className="underline">{form.spec.name}</Link> / Design
      </p>
      <h1 className="text-h1">Design · {form.spec.name}</h1>
      <Designer
        slug={slug} draft={draft} hasDraft={!!form.draftSpec} version={form.version ?? 1}
        publishedNames={inputFields(form.spec).map((f) => f.name)} withData={[...ctx.withData]} hasEntries={ctx.hasEntries}
        encrypted={form.encrypt} isActive={form.isActive}
        versions={(versions ?? []).map((v) => ({ version: v.version as number, note: (v.note as string | null) ?? null, createdAt: formatDateTime(v.created_at as string, org.timezone) }))}
        forms={others.map((f) => ({ slug: f.slug, name: f.spec.name, fields: inputFields(f.spec).filter((x) => !['file', 'signature', 'section', 'table'].includes(x.type)).map((x) => ({ name: x.name, label: x.label.trim() || x.name })) }))}
        timeZone={org.timezone} currency={org.currency}
        supabase={{ url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
        initialTab={tab} flash={flash}
      />
    </section>
  );
}
