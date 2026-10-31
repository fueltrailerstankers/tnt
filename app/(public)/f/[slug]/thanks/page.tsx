import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { buttonClass } from '@/components/ui/styles';
import { appEnv } from '@/lib/env';
import { loadForm } from '@/lib/forms/forms';
import { receiptHeading, receiptReference } from '@/lib/forms/receipt';
import { createAdminClient } from '@/lib/supabase/admin';
import { findAction } from '@/lib/workflow/rules';

export const dynamic = 'force-dynamic';

const DEFAULT = 'Thank you for filling out the form. Your response has been recorded.';

/** Design ThankYou layout; the message always comes from the spec, never from the URL. */
export default async function Thanks({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ a?: string; n?: string }> }) {
  const { slug } = await params;
  const { a, n } = await searchParams;
  const form = await loadForm(createAdminClient(), appEnv().PUBLIC_ORG_ID, slug).catch(() => null);
  const message = (form && a ? findAction(form.spec, a)?.confirmation : undefined) ?? DEFAULT;
  const reference = form ? receiptReference(slug, n) : null;
  return (
    <section className="mx-auto flex max-w-lg flex-col items-center gap-4 rounded-lg border border-border bg-surface px-6 py-10 text-center shadow-card" role="status">
      <span aria-hidden="true" className="flex size-16 items-center justify-center rounded-full bg-status-green-bg text-status-green-fg">
        <Icon name="check" size={32} strokeWidth={2.5} />
      </span>
      <h1 className="text-h1">{receiptHeading(slug, form?.spec.name)}</h1>
      <p className="max-w-[460px] text-[15px] leading-[22px] text-fg-muted">{message}</p>
      {reference ? (
        <p className="text-small text-fg-muted">
          Reference <span className="font-mono font-semibold text-fg">{reference}</span>
        </p>
      ) : null}
      {form?.isActive ? (
        <Link href={`/f/${slug}`} className={buttonClass('secondary', 44, 'mt-2')}>
          Fill in another
        </Link>
      ) : null}
    </section>
  );
}
