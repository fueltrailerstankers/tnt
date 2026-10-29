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
    <section className="space-y-4">
      <p className="text-xs text-fg-muted">
        <Link href="/admin" className="underline">Home</Link> / <Link href={`/admin/forms/${slug}`} className="underline">{form.spec.name}</Link> / New entry
      </p>
      <h1 className="text-h1">New entry · {form.spec.name}</h1>
      {actions.length ? null : (
        <p className="rounded bg-status-yellow-bg p-3 text-sm">
          This form&apos;s first step belongs to its public role ({form.spec.workflow.roles.find((r) => r.public)?.name}). Use the public link to start an entry.
        </p>
      )}
      <div className="rounded-md border bg-surface shadow-card p-4">
        <StaffForm form={form} number={null} initial={defaultData(form.spec, { today: todayIn(org.timezone) })} files={{}} signatures={{}} actions={actions} lookupOptions={options} lookupPanel={[]} version={null} />
      </div>
    </section>
  );
}
