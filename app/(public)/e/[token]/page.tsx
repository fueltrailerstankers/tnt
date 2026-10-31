import { redirect } from 'next/navigation';
import { FormRenderer } from '@/components/form-engine/FormRenderer';
import { publicEnv } from '@/lib/env';
import { loadEntryById } from '@/lib/forms/entries';
import { customerPanel } from '@/lib/forms/lookup';
import { rendererFiles } from '@/lib/forms/view';
import { loadOrg } from '@/lib/forms/org';
import { pickPublic, publicLookupOf } from '@/lib/forms/public-policy';
import { publicData, publicSpec } from '@/lib/spec/values';
import { createAdminClient } from '@/lib/supabase/admin';
import { inspectRoleLink } from '@/lib/workflow/links';
import { Icon } from '@/components/ui/Icon';
import { allowedActions, roleByName } from '@/lib/workflow/rules';
import { findLookupLink, requestUploadLink, submitLink } from './actions';
import { loadFormById } from '@/lib/forms/forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Entry · Trailers & Tankers', referrer: 'no-referrer' };

function StateCard({ icon, tone, title, children }: { icon: 'lock' | 'check' | 'warning'; tone: 'gray' | 'green' | 'yellow'; title: string; children: React.ReactNode }) {
  const toneCls = tone === 'green' ? 'bg-status-green-bg text-status-green-fg' : tone === 'yellow' ? 'bg-status-yellow-bg text-status-yellow-fg' : 'bg-surface-2 text-fg-muted';
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-border bg-surface p-6 text-center shadow-card sm:p-8" role="status">
      <span aria-hidden="true" className={`mx-auto mb-4 flex size-12 items-center justify-center rounded-full ${toneCls}`}>
        <Icon name={icon} size={22} strokeWidth={2} />
      </span>
      <h1 className="text-h1">{title}</h1>
      <div className="mt-2 space-y-2 text-body text-fg-muted">{children}</div>
    </div>
  );
}

function Invalid() {
  return (
    <StateCard icon="lock" tone="gray" title="Link not valid">
      <p>This link is no longer valid: a newer link was sent for this entry, or the address is incomplete. Ask the office to send a new one.</p>
    </StateCard>
  );
}


const sastStamp = (iso: string) => {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return { date, time };
};

export default async function RoleLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = createAdminClient();
  const { status, link } = await inspectRoleLink(db, token);
  if (status !== 'ok' || !link) return <Invalid />;
  const { data: row } = await db.from('entries').select('form_id').eq('id', link.entryId).maybeSingle();
  const form = row ? await loadFormById(db, row.form_id) : null;
  const entry = form ? await loadEntryById(db, form, link.entryId) : null;
  if (!form || !entry) return <Invalid />;
  // Turning a form's public link off also stops its role links.
  if (!form.isActive && roleByName(form.spec, link.roleName)?.public) return <Invalid />;

  const role = roleByName(form.spec, link.roleName);
  // Internal roles never act through a bearer link: send them to the signed-in entry page.
  if (!role?.public) redirect(`/admin/forms/${form.slug}/entries/${entry.number}`);

  const actions = allowedActions(form.spec, entry.status, role.name).map((a) => ({ name: a.name, label: a.button }));
  // A signed Delivery Note is the customer's record: the link confirms it instead of showing the form again.
  if (form.slug === 'delivery-note' && actions.length === 0 && entry.status !== 'Incomplete') {
    const { date, time } = sastStamp(entry.submittedAt ?? entry.updatedAt);
    return (
      <StateCard icon="check" tone="green" title="Already signed">
        <p>This Delivery Note was signed on {date} at {time} SAST.</p>
        <p>Reference <span className="font-mono font-semibold text-fg">DN-{entry.number}</span></p>
      </StateCard>
    );
  }
  // M8: only what the public role may see leaves the server: public spec, data, files, signatures and lookup.
  const all = await rendererFiles(db, entry, true);
  const files = pickPublic(form.spec, all.files);
  const signatures = pickPublic(form.spec, all.signatures);
  const lookup = publicLookupOf(form.spec);
  const lookupId = lookup ? (entry.data[lookup.name] as string | undefined) : undefined;
  const panel = lookup && lookupId ? await customerPanel(db, form.orgId, lookup.lookup.sourceForm, lookupId, true) : [];
  const env = publicEnv();
  const org = await loadOrg(db, form.orgId);

  return (
    <>
      <h1 className="text-h1">{form.spec.name}</h1>
      <p className="mb-6 mt-1.5 text-small text-fg-muted">
        Entry #{entry.number} · {entry.status}
        {actions.length === 0 ? ' · No action is available for you at this stage.' : ''}
      </p>
      <FormRenderer
        spec={publicSpec(form.spec)}
        initial={publicData(form.spec, entry.data)}
        files={files}
        signatures={signatures}
        actions={actions}
        submit={submitLink.bind(null, token)}
        upload={requestUploadLink.bind(null, token)}
        supabase={{ url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
        lookup={lookup ? { mode: 'exact', find: findLookupLink.bind(null, token) } : undefined}
        lookupPanel={panel}
        hidden={{ __version: entry.updatedAt }}
        audience="public"
        timeZone={org.timezone}
        currency={org.currency}
      />
    </>
  );
}
