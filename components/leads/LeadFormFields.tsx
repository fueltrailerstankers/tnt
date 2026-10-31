import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/Field';
import type { UiSource } from '@/lib/leads-view/actions';

// Fields of the Add lead modal and the /admin/leads/new page. Names match lib/leads/schema ManualLead.

export type LeadFieldErrors = Partial<Record<'name' | 'email' | 'phone' | 'product' | 'branch' | 'message' | 'source' | 'form', string>>;

export function LeadFormFields({ idPrefix, errors = {}, sources, branches = [] }: {
  idPrefix: string;
  errors?: LeadFieldErrors;
  /** Active sources staff may pick; the select is hidden when only Manual is available. */
  sources: readonly UiSource[];
  branches?: readonly string[];
}) {
  const id = (f: string) => `${idPrefix}-${f}`;
  const err = (f: keyof LeadFieldErrors) => (errors[f] ? { 'aria-invalid': true as const, 'aria-describedby': id(`${f}-err`) } : {});
  const showError = (f: keyof LeadFieldErrors) => (errors[f] ? <FieldError id={id(`${f}-err`)}>{errors[f]}</FieldError> : null);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label htmlFor={id('name')}>Name</Label>
        <Input id={id('name')} name="name" maxLength={160} autoComplete="off" placeholder="Company or contact name" {...err('name')} />
        {showError('name')}
      </div>
      <div>
        <Label htmlFor={id('phone')}>Phone</Label>
        <Input id={id('phone')} name="phone" type="tel" maxLength={40} autoComplete="off" {...err('phone')} />
        {showError('phone')}
      </div>
      <div>
        <Label htmlFor={id('email')}>Email</Label>
        <Input id={id('email')} name="email" type="email" maxLength={254} autoComplete="off" {...err('email')} />
        {showError('email')}
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={id('product')}>Product / interest</Label>
        <Input id={id('product')} name="product" maxLength={300} placeholder="e.g. 2-compartment diesel bowser" {...err('product')} />
        {showError('product')}
      </div>
      <div className={sources.length > 1 ? '' : 'sm:col-span-2'}>
        <Label htmlFor={id('branch')}>Branch</Label>
        <Input id={id('branch')} name="branch" maxLength={60} list={branches.length ? id('branches') : undefined} {...err('branch')} />
        {branches.length ? <datalist id={id('branches')}>{branches.map((b) => <option key={b} value={b} />)}</datalist> : null}
        {showError('branch')}
      </div>
      {sources.length > 1 ? (
        <div>
          <Label htmlFor={id('source')}>Source</Label>
          <Select id={id('source')} name="source" defaultValue="manual" {...err('source')}>
            {sources.map((s) => <option key={s} value={s}>{s === 'manual' ? 'Manual' : 'Test'}</option>)}
          </Select>
          {showError('source')}
        </div>
      ) : <input type="hidden" name="source" value="manual" />}
      <div className="sm:col-span-2">
        <Label htmlFor={id('message')}>Message</Label>
        <Textarea id={id('message')} name="message" rows={3} maxLength={4000} {...err('message')} />
        {showError('message')}
      </div>
    </div>
  );
}

export const DEDUPE_NOTE = 'On save we check the phone and email against existing leads (a match is flagged as a possible duplicate, never merged) and match Xero contacts. No notification is sent.';
