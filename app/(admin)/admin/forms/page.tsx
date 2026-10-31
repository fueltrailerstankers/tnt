import Link from 'next/link';
import { buttonClass, cardClass } from '@/components/ui/styles';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Forms · Trailers & Tankers' };

interface Overview {
  form_id: string;
  slug: string;
  name: string;
  is_active: boolean;
  entries: number;
  unread: number;
}

export default async function FormsIndex() {
  const member = await requirePerm('forms.read');
  const canImport = can(member, 'import.run');
  const manage = can(member, 'forms.manage'); // M8: builder links
  const db = await createClient();
  const { data } = await db.rpc('form_overview');
  const forms = (data ?? []) as Overview[];

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-h1">Forms</h1>
        <div className="flex flex-wrap gap-2">
          {canImport ? <Link href="/admin/forms/import" className={buttonClass('secondary', 36)}>Import from Cognito</Link> : null}
          {manage ? <Link href="/admin/forms/new" className={buttonClass('primary', 36)}>New form</Link> : null}
        </div>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {forms.map((f) => (
          <li key={f.form_id} className={`${cardClass} flex flex-col gap-3 p-4`} data-testid={`form-card-${f.slug}`}>
            <div className="flex items-start justify-between gap-2">
              <Link href={`/admin/forms/${f.slug}`} className="text-h2 text-fg no-underline hover:underline">{f.name}</Link>
              {f.unread ? <span className="text-small font-semibold text-accent-text">{f.unread} new</span> : null}
            </div>
            <p className="text-small text-fg-muted">
              <span className="font-mono">{f.entries}</span> entries · {f.is_active ? 'Public link on' : 'Internal'}
            </p>
            <div className="mt-auto flex flex-wrap gap-2">
              <Link href={`/admin/forms/${f.slug}/new`} className={buttonClass('primary', 36)}>New entry</Link>
              <Link href={`/admin/forms/${f.slug}`} className={buttonClass('secondary', 36)}>Entries</Link>
              {canImport ? <Link href={`/admin/forms/import#form-${f.slug}`} className={buttonClass('ghost', 36)}>Import entries</Link> : null}
              {manage ? <Link href={`/admin/forms/${f.slug}/design`} className={buttonClass('secondary', 36)}>Design</Link> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
