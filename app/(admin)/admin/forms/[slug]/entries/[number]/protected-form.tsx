import { FormRenderer } from '@/components/form-engine/FormRenderer';
import type { ExistingFile } from '@/components/form-engine/types';
import { publicEnv } from '@/lib/env';
import type { FormRecord } from '@/lib/forms/forms';
import type { LookupOption } from '@/lib/forms/lookup-types';
import { quoteFieldOf } from '@/lib/forms/quote-fields';
import type { FormSpec } from '@/lib/spec/types';
import type { EntryData } from '@/lib/spec/values';
import { importQuoteStaff, lookupPanelStaff, requestUploadStaff, searchQuotesStaff } from '../../actions';
import { saveEntryKeepingProtected } from './actions';

/**
 * The entry form for forms with protected fields (StaffForm otherwise). The renderer gets the page spec (protected
 * fields hidden) and data without the protected values; saves go through saveEntryKeepingProtected, which puts the
 * stored values back before runAction. Everything else is wired as in StaffForm.
 */
export function ProtectedEntryForm(props: {
  form: FormRecord;
  spec: FormSpec;
  number: number;
  initial: EntryData;
  files: Record<string, ExistingFile[]>;
  signatures: Record<string, ExistingFile>;
  actions: Array<{ name: string; label: string }>;
  lookupOptions: LookupOption[] | null;
  lookupPanel: Array<[string, string]>;
  version: string;
  timeZone: string;
  currency: string;
}) {
  const env = publicEnv();
  const slug = props.form.slug;
  return (
    <FormRenderer
      spec={props.spec}
      initial={props.initial}
      files={props.files}
      signatures={props.signatures}
      actions={props.actions}
      submit={saveEntryKeepingProtected.bind(null, slug, props.number)}
      upload={requestUploadStaff.bind(null, slug)}
      supabase={{ url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
      lookup={props.lookupOptions ? { mode: 'list', options: props.lookupOptions, panel: lookupPanelStaff.bind(null, slug) } : undefined}
      lookupPanel={props.lookupPanel}
      quotes={quoteFieldOf(props.spec) ? { mode: 'search', search: searchQuotesStaff.bind(null, slug) } : undefined}
      hidden={{ __version: props.version }}
      importQuote={slug === 'deal' ? importQuoteStaff.bind(null, slug) : undefined}
      timeZone={props.timeZone}
      currency={props.currency}
      draftScope={{ kind: 'entry', number: props.number }}
    />
  );
}
