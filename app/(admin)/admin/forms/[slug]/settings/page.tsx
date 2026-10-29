import Link from 'next/link';
import { adminForm } from '@/lib/admin/context';
import { appEnv } from '@/lib/env';
import { eventKey } from '@/lib/workflow/email-template';
import { addRecipient, removeRecipient, setPublicLink } from './actions';

export const dynamic = 'force-dynamic';

export default async function FormSettings({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const { error } = await searchParams;
  const { member, userDb, form } = await adminForm(slug, 'forms.manage');
  const { data: recipients } = await userDb.from('notification_recipients').select('id, event_key, address, active').eq('org_id', member.orgId).like('event_key', `${slug}.%`).order('event_key');
  const emailing = form.spec.workflow.actions.filter((a) => a.emails.some((e) => e.to.some((t) => !t.startsWith('['))));
  const url = `${appEnv().APP_URL}/f/${slug}`;

  return (
    <section className="max-w-3xl space-y-6">
      <p className="text-xs text-fg-muted">
        <Link href="/admin" className="underline">Home</Link> / <Link href={`/admin/forms/${slug}`} className="underline">{form.spec.name}</Link> / Settings
      </p>
      <h1 className="text-h1">Form settings · {form.spec.name}</h1>

      <form action={setPublicLink.bind(null, slug)} className="space-y-2 rounded-md border bg-surface shadow-card p-4">
        <h2 className="font-semibold">Public link</h2>
        <p className="text-sm"><a href={url} className="underline">{url}</a></p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={form.isActive} className="h-5 w-5" /> Public link is on
        </label>
        <button className="rounded-pill border border-border-strong bg-surface font-semibold text-fg no-underline px-3 py-1 text-sm">Save</button>
      </form>

      <div className="space-y-3 rounded-md border bg-surface shadow-card p-4">
        <h2 className="font-semibold">Notification recipients</h2>
        <p className="text-sm text-fg-muted">Inboxes that get the form&apos;s emails. Field addresses such as [InspectorEmail] come from the entry and are not listed here.</p>
        {error ? <p className="text-sm text-status-red-fg">Enter a valid email address and choose an action.</p> : null}
        <ul className="divide-y text-sm">
          {(recipients ?? []).map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2">
              <span><span className="font-mono text-xs">{r.event_key.slice(slug.length + 1)}</span> → {r.address}</span>
              <form action={removeRecipient.bind(null, slug, r.id)}>
                <button className="text-xs text-status-red-fg underline">Remove</button>
              </form>
            </li>
          ))}
          {!recipients?.length ? <li className="py-2 text-fg-muted">No recipients configured.</li> : null}
        </ul>
        {emailing.length ? (
          <form action={addRecipient.bind(null, slug)} className="flex flex-wrap items-end gap-2 text-sm">
            <label className="flex flex-col">
              <span className="text-xs text-fg-muted">Action</span>
              <select name="action" className="rounded-sm border px-2 py-1">
                {emailing.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col">
              <span className="text-xs text-fg-muted">Email</span>
              <input name="address" type="email" required className="rounded-sm border px-2 py-1" />
            </label>
            <button className="rounded-pill border border-border-strong bg-surface font-semibold text-fg no-underline px-3 py-1">Add</button>
          </form>
        ) : <p className="text-sm text-fg-muted">This form sends no emails to fixed inboxes.</p>}
        <p className="text-xs text-fg-muted">Event keys: {emailing.map((a) => eventKey(slug, a.name)).join(', ') || 'none'}</p>
      </div>
    </section>
  );
}
