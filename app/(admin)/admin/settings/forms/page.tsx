import Link from 'next/link';
import { SettingsTabs } from '@/components/users/SettingsTabs';
import { loadForms } from '@/lib/forms/forms';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Forms · Settings · Trailers & Tankers' };

export default async function SettingsForms() {
  const member = await requirePerm('settings.read');
  const forms = await loadForms(await createClient(), member.orgId);
  const manage = can(member, 'forms.manage');

  return (
    <section className="max-w-3xl space-y-6">
      <h1 className="text-h1">Settings</h1>
      <SettingsTabs member={member} current="forms" />
      <div className="rounded-md border bg-surface shadow-card p-4 text-sm">
        <h2 className="mb-2 font-semibold">Forms</h2>
        <ul className="divide-y">
          {forms.map((f) => (
            <li key={f.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>{f.spec.name}</span>
              {manage ? <Link href={`/admin/forms/${f.slug}/settings`} className="underline">Public link and recipients</Link>
                : <span className="text-fg-muted">{f.isActive ? 'Public link on' : 'Public link off'}</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
