import { notFound } from 'next/navigation';
import { FormRenderer } from '@/components/form-engine/FormRenderer';
import { appEnv, publicEnv } from '@/lib/env';
import { loadForm } from '@/lib/forms/forms';
import { quoteFieldOf } from '@/lib/forms/quote-fields';
import { loadOrg } from '@/lib/forms/org';
import { defaultData, todayIn } from '@/lib/spec/values';
import { createAdminClient } from '@/lib/supabase/admin';
import { allowedActions, NEW_ENTRY_STATUS, publicRole } from '@/lib/workflow/rules';
import { checkQuotePublic, findLookupPublic, requestUploadPublic, submitPublic } from './actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = await loadForm(createAdminClient(), appEnv().PUBLIC_ORG_ID, slug).catch(() => null);
  return { title: form ? `${form.spec.name} · Trailers & Tankers` : 'Form · Trailers & Tankers' };
}

export default async function PublicFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = await loadForm(createAdminClient(), appEnv().PUBLIC_ORG_ID, slug);
  if (!form || !form.isActive) notFound();
  const spec = form.spec;
  const org = await loadOrg(createAdminClient(), form.orgId);
  const actions = allowedActions(spec, NEW_ENTRY_STATUS, publicRole(spec).name).map((a) => ({ name: a.name, label: a.button }));
  const env = publicEnv();
  const hasLookup = spec.fields.some((f) => f.type === 'lookup');

  return (
    <>
      <h1 className="mb-4 text-h1">{spec.name}</h1>
      <FormRenderer
        spec={spec}
        initial={defaultData(spec, { today: todayIn(org.timezone) })}
        files={{}}
        signatures={{}}
        actions={actions}
        submit={submitPublic.bind(null, slug)}
        upload={requestUploadPublic.bind(null, slug)}
        supabase={{ url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
        lookup={hasLookup ? { mode: 'exact', find: findLookupPublic.bind(null, slug) } : undefined}
        quotes={quoteFieldOf(spec) ? { mode: 'check', check: checkQuotePublic.bind(null, slug) } : undefined}
        honeypot
      />
    </>
  );
}
