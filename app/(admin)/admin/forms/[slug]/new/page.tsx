import Link from 'next/link';
import { adminForm } from '@/lib/admin/context';
import { lookupOptions } from '@/lib/forms/lookup';
import { can } from '@/lib/security/can';
import { defaultData, todayIn } from '@/lib/spec/values';
import { actionPermission, allowedActions, internalRole, NEW_ENTRY_STATUS } from '@/lib/workflow/rules';
import { StaffForm } from '../staff-form';

export const dynamic = 'force-dynamic';

export default async function NewEntry({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { member, db, form, org } = await adminForm(slug, 'entries.write');
  const actions = allowedActions(form.spec, NEW_ENTRY_STATUS, internalRole(form.spec).name)
    .filter((a) => can(member, actionPermission(a)))
    .map((a) => ({ name: a.name, label: a.button }));
  const lookup = form.spec.fields.find((f) => f.type === 'lookup');
  const options = lookup && lookup.type === 'lookup' ? await lookupOptions(db, form.orgId, lookup.lookup.sourceForm, lookup.lookup.displayField) : null;

  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <nav aria-label="Breadcrumb" className="text-small text-fg-muted">
        <Link href="/admin/forms" className="text-fg-muted hover:text-fg">Forms</Link> / <Link href={`/admin/forms/${slug}`} className="text-fg-muted hover:text-fg">{form.spec.name}</Link> / <span className="text-fg">New entry</span>
      </nav>
      <h1 className="text-h1">New entry · {form.spec.name}</h1>
      {actions.length ? null : (
        <p className="rounded-md bg-status-yellow-bg px-4 py-3 text-body text-status-yellow-fg">
          This form&apos;s first step belongs to its public role ({form.spec.workflow.roles.find((r) => r.public)?.name}). Use the public link to start an entry.
        </p>
      )}
      <div className="min-w-0">
        <StaffForm
          form={form} number={null} initial={defaultData(form.spec, { today: todayIn(org.timezone), now: new Date(), timeZone: org.timezone, currency: org.currency })}
          files={{}} signatures={{}} actions={actions} lookupOptions={options} lookupPanel={[]} version={null} timeZone={org.timezone} currency={org.currency}
        />
      </div>
    </section>
  );
}
