import { redirect } from 'next/navigation';
import { FormRenderer } from '@/components/form-engine/FormRenderer';
import { publicEnv } from '@/lib/env';
import { loadEntryById } from '@/lib/forms/entries';
import { customerPanel } from '@/lib/forms/lookup';
import { rendererFiles } from '@/lib/forms/view';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveRoleLink } from '@/lib/workflow/links';
import { allowedActions, roleByName } from '@/lib/workflow/rules';
import { findLookupLink, requestUploadLink, submitLink } from './actions';
import { loadFormById } from '@/lib/forms/forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Entry · Trailers & Tankers', referrer: 'no-referrer' };

function Invalid() {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-border bg-surface p-6 text-center shadow-card sm:p-8" role="status">
      <h1 className="text-h1">Link not valid</h1>
      <p className="mt-2 text-body text-fg-muted">This link has expired or is no longer valid. Ask the office to send a new one.</p>
    </div>
  );
}

export default async function RoleLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = createAdminClient();
  const link = await resolveRoleLink(db, token);
  if (!link) return <Invalid />;
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
  const { files, signatures } = await rendererFiles(db, entry, true);
  const lookup = form.spec.fields.find((f) => f.type === 'lookup');
  const lookupId = lookup && lookup.type === 'lookup' ? (entry.data[lookup.name] as string | undefined) : undefined;
  const panel = lookup && lookup.type === 'lookup' && lookupId ? await customerPanel(db, form.orgId, lookup.lookup.sourceForm, lookupId, true) : [];
  const env = publicEnv();

  return (
    <>
      <h1 className="text-h1">{form.spec.name}</h1>
      <p className="mb-6 mt-1.5 text-small text-fg-muted">
        Entry #{entry.number} · {entry.status}
        {actions.length === 0 ? ' · No action is available for you at this stage.' : ''}
      </p>
      <FormRenderer
        spec={form.spec}
        initial={entry.data}
        files={files}
        signatures={signatures}
        actions={actions}
        submit={submitLink.bind(null, token)}
        upload={requestUploadLink.bind(null, token)}
        supabase={{ url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
        lookup={lookup ? { mode: 'exact', find: findLookupLink.bind(null, token) } : undefined}
        lookupPanel={panel}
        hidden={{ __version: entry.updatedAt }}
      />
    </>
  );
}
