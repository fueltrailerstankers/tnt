import Link from 'next/link';
import { FormCard } from '@/components/entries/FormCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { buttonClass } from '@/components/ui/styles';
import { awaitingStatuses, formCard, formsSummary, publicUrl } from '@/lib/admin/forms-index';
import { appEnv } from '@/lib/env';
import { loadForms } from '@/lib/forms/forms';
import { sortForHome } from '@/lib/home/forms';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Forms · Trailers & Tankers' };

interface Overview {
  form_id: string;
  slug: string;
  entries: number;
  unread: number;
}

/** Forms index (handoff FormsIndex.dc.html): one card per form with counts, New entry and the public link. */
export default async function FormsIndex() {
  const member = await requirePerm('forms.read');
  const canImport = can(member, 'import.run');
  const manage = can(member, 'forms.manage'); // M8: builder links
  const db = await createClient();
  // Both reads run as the caller (RLS: their org only). form_overview leaves archived forms out.
  const [{ data, error }, forms] = await Promise.all([db.rpc('form_overview'), loadForms(db, member.orgId)]);
  if (error) throw new Error('form_overview');
  const overview = new Map(((data ?? []) as Overview[]).map((o) => [o.form_id, o]));
  const live = sortForHome(forms.filter((f) => overview.has(f.id)));

  // Entries waiting on staff, for the card flag ("3 awaiting approval", "1 APPROVAL"); head counts, no rows.
  const awaiting = new Map(await Promise.all(live.map(async (f) => {
    const statuses = awaitingStatuses(f.spec);
    if (!statuses.length) return [f.id, 0] as const;
    const { count } = await db.from('entries').select('id', { count: 'exact', head: true }).eq('form_id', f.id).in('status', statuses);
    return [f.id, count ?? 0] as const;
  })));

  const cards = live.map((f) => {
    const o = overview.get(f.id)!;
    return formCard(f, { entries: Number(o.entries) || 0, unread: Number(o.unread) || 0, awaiting: awaiting.get(f.id) ?? 0 }, member);
  });
  const appUrl = appEnv().APP_URL;

  return (
    <section className="flex flex-col gap-5" aria-labelledby="forms-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 id="forms-title" className="m-0 text-h1">Forms</h1>
          <p className="m-0 text-small text-fg-muted">{formsSummary(cards)}</p>
        </div>
        {canImport || manage ? (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {canImport ? (
              <Link href="/admin/forms/import" className={buttonClass('secondary', 44, 'flex-1 sm:h-9 sm:flex-none sm:px-3.5 sm:text-body')}>Import from Cognito</Link>
            ) : null}
            {manage ? (
              <Link href="/admin/forms/new" className={buttonClass('primary', 44, 'flex-1 sm:h-9 sm:flex-none sm:px-3.5 sm:text-body')}>
                <Icon name="plus" size={14} strokeWidth={2.25} />
                New form
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {cards.length ? (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(330px,100%),1fr))] gap-4 p-0">
          {cards.map((c) => (
            <FormCard
              key={c.slug}
              card={c}
              links={{
                publicUrl: c.publicPath ? publicUrl(appUrl, c.publicPath) : null,
                design: manage,
                settings: manage,
                importEntries: canImport,
              }}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon="forms"
          title="No forms yet"
          body={manage ? 'Create a form, or import one from Cognito.' : 'Forms appear here once an admin creates them.'}
        />
      )}
    </section>
  );
}
