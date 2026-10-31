import Link from 'next/link';
import { addLeadSources } from '@/components/leads/LeadsInbox';
import { DEDUPE_NOTE, LeadFormFields } from '@/components/leads/LeadFormFields';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { buttonClass } from '@/components/ui/styles';
import { fieldErrors } from '@/lib/leads-view/actions';
import { requirePerm } from '@/lib/security/require';
import { createManualLead } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Add lead · Trailers & Tankers' };

/** Full-page Add lead (the inbox opens the same form in a modal; this page also works without JavaScript). */
export default async function NewLead({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requirePerm('leads.manage');
  const sp = await searchParams;
  const sources = await addLeadSources(member);
  const errors = typeof sp.error === 'string' ? fieldErrors(sp.error.split(',').slice(0, 10)) : {};
  return (
    <section className="flex max-w-xl flex-col gap-4">
      <Link href="/admin/leads" className="inline-flex min-h-11 items-center gap-1 self-start text-small font-semibold text-accent-text no-underline">
        <Icon name="chevronLeft" size={18} strokeWidth={2} />Back to leads
      </Link>
      <h1 className="m-0 text-h1">Add lead</h1>
      <p className="m-0 text-small text-fg-muted">For leads taken by phone, walk-in or email. Give at least an email or a phone number.</p>
      <Card>
        <form action={createManualLead} className="flex flex-col gap-3">
          {errors.form ? <p role="alert" className="m-0 rounded-sm bg-status-red-bg px-3 py-2 text-small text-status-red-fg">{errors.form}</p> : null}
          <LeadFormFields idPrefix="new-lead" errors={errors} sources={sources} />
          <p className="m-0 text-[12px] leading-4 text-fg-muted">{DEDUPE_NOTE}</p>
          <div className="flex justify-end gap-2">
            <Link href="/admin/leads" className={buttonClass('secondary', 38)}>Cancel</Link>
            <button type="submit" className={buttonClass('primary', 38)}>Save lead</button>
          </div>
        </form>
      </Card>
    </section>
  );
}
