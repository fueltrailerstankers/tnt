import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { buttonClass } from '@/components/ui/styles';
import { appEnv } from '@/lib/env';
import { loadForm } from '@/lib/forms/forms';
import { createAdminClient } from '@/lib/supabase/admin';
import { findAction } from '@/lib/workflow/rules';

export const dynamic = 'force-dynamic';

const DEFAULT = 'Thank you for filling out the form. Your response has been recorded.';

export default async function Thanks({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ a?: string }> }) {
  const { slug } = await params;
  const { a } = await searchParams;
  const form = await loadForm(createAdminClient(), appEnv().PUBLIC_ORG_ID, slug).catch(() => null);
  // The message always comes from the spec, never from the URL.
  const message = (form && a ? findAction(form.spec, a)?.confirmation : undefined) ?? DEFAULT;
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-border bg-surface p-6 text-center shadow-card sm:p-8" role="status">
      <span aria-hidden="true" className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-status-green-bg text-status-green-fg">
        <Icon name="check" size={24} strokeWidth={2.5} />
      </span>
      <h1 className="text-h1">{form?.spec.name ?? 'Thank you'}</h1>
      <p className="mt-2 text-body text-fg-muted">{message}</p>
      {form?.isActive ? (
        <Link href={`/f/${slug}`} className={buttonClass('secondary', 44, 'mt-6')}>
          Fill in another
        </Link>
      ) : null}
    </div>
  );
}
