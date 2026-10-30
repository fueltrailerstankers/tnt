'use client';

import { useActionState, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Input, Label, Select } from '@/components/ui/Field';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { buttonClass, cardClass } from '@/components/ui/styles';
import { createFormAction, type CreateState } from './actions';

type How = 'blank' | 'duplicate' | 'import';

export function NewFormClient({ forms }: { forms: Array<{ slug: string; name: string }> }) {
  const [state, action, pending] = useActionState(createFormAction, {} as CreateState);
  const [how, setHow] = useState<How>('blank');
  return (
    <form action={action} className={`${cardClass} max-w-2xl space-y-5 p-5`}>
      <input type="hidden" name="how" value={how} />
      <SegmentedControl<How>
        name="how-choice" label="Start from" value={how} onChange={setHow}
        options={[{ value: 'blank', label: 'Blank' }, { value: 'duplicate', label: 'Duplicate' }, { value: 'import', label: 'Import JSON' }]}
      />
      {state.problems?.length ? (
        <Alert tone="error" title="The form was not created">
          <ul className="list-disc pl-5">{state.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </Alert>
      ) : null}
      <div>
        <Label htmlFor="nf-name" required>Form name</Label>
        <Input id="nf-name" name="name" required maxLength={120} autoComplete="off" />
      </div>
      <div>
        <Label htmlFor="nf-slug">Slug (link)</Label>
        <Input id="nf-slug" name="slug" maxLength={64} pattern="[a-z0-9-]*" placeholder="made from the name" autoComplete="off" aria-describedby="nf-slug-help" />
        <p id="nf-slug-help" className="mt-1 text-small text-fg-muted">Lower-case letters, numbers and dashes. The public link is /f/&lt;slug&gt;. It cannot change after the form is created.</p>
      </div>
      {how === 'duplicate' ? (
        <div>
          <Label htmlFor="nf-source" required>Form to copy</Label>
          <Select id="nf-source" name="source" defaultValue="">
            <option value="" disabled>Choose a form</option>
            {forms.map((f) => <option key={f.slug} value={f.slug}>{f.name}</option>)}
          </Select>
          <p className="mt-1 text-small text-fg-muted">Copies the fields, workflow and documents. Entries are not copied.</p>
        </div>
      ) : null}
      {how === 'import' ? (
        <div>
          <Label htmlFor="nf-file" required>FormSpec JSON</Label>
          <input id="nf-file" name="file" type="file" accept="application/json,.json" className="block w-full text-body" />
          <p className="mt-1 text-small text-fg-muted">A form exported from here (Export JSON) or a kit spec. Its slug and name are replaced by the ones above.</p>
        </div>
      ) : null}
      {how === 'blank' ? (
        <div>
          <Label htmlFor="nf-template">Workflow</Label>
          <Select id="nf-template" name="template" defaultValue="public-submit">
            <option value="public-submit">Public submit, staff update</option>
            <option value="internal-only">Internal only</option>
          </Select>
        </div>
      ) : null}
      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-small font-semibold text-fg">Options</legend>
        <label className="flex min-h-11 items-center gap-2 text-body"><input type="checkbox" name="publicLink" className="size-5" /> Public link on</label>
        <label className="flex min-h-11 items-center gap-2 text-body"><input type="checkbox" name="encrypt" className="size-5" /> Encrypt entries (only before the first entry)</label>
      </fieldset>
      <p className="text-small text-fg-muted">Entry numbers start at 1. Pick the entry summary fields in the designer.</p>
      <button type="submit" disabled={pending} className={buttonClass('primary', 44)}>{pending ? 'Creating…' : 'Create form'}</button>
    </form>
  );
}
