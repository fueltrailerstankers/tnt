import { FormRenderer } from '@/components/form-engine/FormRenderer';
import type { ExistingFile } from '@/components/form-engine/types';
import type { FormRecord } from '@/lib/forms/forms';
import type { LookupOption } from '@/lib/forms/lookup-types';
import { publicEnv } from '@/lib/env';
import { quoteFieldOf } from '@/lib/forms/quote-fields';
import type { EntryData } from '@/lib/spec/values';
import { lookupPanelStaff, requestUploadStaff, saveEntryStaff, searchQuotesStaff } from './actions';

/** Server wrapper that wires the renderer to the staff actions for one form (and entry). */
export function StaffForm(props: {
  form: FormRecord;
  number: number | null;
  initial: EntryData;
  files: Record<string, ExistingFile[]>;
  signatures: Record<string, ExistingFile>;
  actions: Array<{ name: string; label: string }>;
  lookupOptions: LookupOption[] | null;
  lookupPanel: Array<[string, string]>;
  version: string | null;
}) {
  const env = publicEnv();
  const slug = props.form.slug;
  return (
    <FormRenderer
      spec={props.form.spec}
      initial={props.initial}
      files={props.files}
      signatures={props.signatures}
      actions={props.actions}
      submit={saveEntryStaff.bind(null, slug, props.number)}
      upload={requestUploadStaff.bind(null, slug)}
      supabase={{ url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
      lookup={props.lookupOptions ? { mode: 'list', options: props.lookupOptions, panel: lookupPanelStaff.bind(null, slug) } : undefined}
      lookupPanel={props.lookupPanel}
      quotes={quoteFieldOf(props.form.spec) ? { mode: 'search', search: searchQuotesStaff.bind(null, slug) } : undefined}
      hidden={props.version ? { __version: props.version } : {}}
    />
  );
}
