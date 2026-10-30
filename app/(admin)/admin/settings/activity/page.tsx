import Link from 'next/link';
import { Input, Label, Select } from '@/components/ui/Field';
import { buttonClass, cardClass } from '@/components/ui/styles';
import { ActivityList } from '@/components/users/ActivityList';
import { SettingsTabs } from '@/components/users/SettingsTabs';
import { filterQuery, FILTER_AREAS, KNOWN_ACTIONS, parseFilters } from '@/lib/activity/describe';
import { ACTIVITY_PAGE, loadActivity } from '@/lib/activity/query';
import { loadOrg } from '@/lib/forms/org';
import { AREA_LABELS } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { memberNames } from '@/lib/users/service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Activity log · Trailers & Tankers' };

export default async function Activity({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requirePerm('audit.read');
  const f = parseFilters(await searchParams);
  const db = await createClient();
  const org = await loadOrg(db, member.orgId);
  const [names, { rows, total }] = await Promise.all([
    memberNames(member.orgId),
    loadActivity(db, member.orgId, f, org.timezone, ACTIVITY_PAGE, (f.page - 1) * ACTIVITY_PAGE),
  ]);
  const pages = Math.max(1, Math.ceil(total / ACTIVITY_PAGE));
  const people = [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <section className="max-w-5xl space-y-5">
      <h1 className="text-h1">Settings</h1>
      <SettingsTabs member={member} current="activity" />

      <form method="get" className={`${cardClass} grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6`}>
        <div>
          <Label htmlFor="f-user">User</Label>
          <Select id="f-user" name="user" defaultValue={f.user ?? ''}>
            <option value="">Everyone</option>
            {people.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="f-area">Area</Label>
          <Select id="f-area" name="area" defaultValue={f.area ?? ''}>
            <option value="">All areas</option>
            {FILTER_AREAS.map((a) => <option key={a} value={a}>{AREA_LABELS[a]}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="f-action">Action</Label>
          <Input id="f-action" name="action" list="known-actions" defaultValue={f.action ?? ''} placeholder="e.g. auth.sign_in" autoComplete="off" />
          <datalist id="known-actions">{KNOWN_ACTIONS.map((a) => <option key={a} value={a} />)}</datalist>
        </div>
        <div>
          <Label htmlFor="f-from">From</Label>
          <Input id="f-from" name="from" type="date" defaultValue={f.from ?? ''} />
        </div>
        <div>
          <Label htmlFor="f-to">To</Label>
          <Input id="f-to" name="to" type="date" defaultValue={f.to ?? ''} />
        </div>
        <div>
          <Label htmlFor="f-q">Record id</Label>
          <Input id="f-q" name="q" defaultValue={f.q ?? ''} autoComplete="off" />
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-3 lg:col-span-6">
          <button className={buttonClass('primary', 44)}>Apply</button>
          <Link href="/admin/settings/activity" className={buttonClass('secondary', 44)}>Clear</Link>
          <a href={`/admin/settings/activity/export${filterQuery(f, { page: null })}`} className={buttonClass('secondary', 44, 'ml-auto')}>Export CSV</a>
        </div>
      </form>

      <div className={`${cardClass} p-4`}>
        <p className="mb-2 text-fg-muted" data-testid="activity-total">{total} {total === 1 ? 'event' : 'events'}, newest first. Times in {org.timezone}.</p>
        <ActivityList rows={rows} names={names} timeZone={org.timezone} empty="Nothing matches these filters." />
      </div>

      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-2">
          {f.page > 1 ? <Link href={`/admin/settings/activity${filterQuery(f, { page: f.page - 1 })}`} className={buttonClass('secondary', 44)}>Newer</Link> : <span />}
          <span className="text-fg-muted">Page {f.page} of {pages}</span>
          {f.page < pages ? <Link href={`/admin/settings/activity${filterQuery(f, { page: f.page + 1 })}`} className={buttonClass('secondary', 44)}>Older</Link> : <span />}
        </nav>
      ) : null}
    </section>
  );
}
