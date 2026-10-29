import Link from 'next/link';
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
    <div className="space-y-4 rounded border bg-white p-6" role="status">
      <h1 className="text-xl font-semibold">{form?.spec.name ?? 'Thank you'}</h1>
      <p>{message}</p>
      {form?.isActive ? (
        <Link href={`/f/${slug}`} className="inline-block rounded border px-4 py-2">
          Fill in another
        </Link>
      ) : null}
    </div>
  );
}
