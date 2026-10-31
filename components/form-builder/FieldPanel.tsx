'use client';

// Property panel of the form designer: every option of the selected field (M8 Part A spec), incl. required and
// a show-when builder. Pure helpers stay in lib/forms/builder.
import { useState } from 'react';
import { Input, Label, Select, Textarea } from '@/components/ui/Field';
import { buttonClass } from '@/components/ui/styles';
import { WIDTH_SPAN, widthOf, type Width } from '@/lib/forms/builder/layout';
import { fieldNameFromLabel } from '@/lib/forms/builder/names';
import { newField, PALETTE, type PaletteType } from '@/lib/forms/builder/palette';
import { parseShowWhen } from '@/lib/spec/expressions';
import type { FieldSpec } from '@/lib/spec/types';

type AnyField = FieldSpec & Record<string, unknown>;

export interface PanelProps {
  field: FieldSpec;
  sameRow: boolean;
  /** Names of the other fields (for show-when and unique names). */
  others: Array<{ name: string; label: string; type: string }>;
  /** The field's name is fixed: it is in the published spec or holds data. */
  nameFixed: boolean;
  hasData: boolean;
  forms: Array<{ slug: string; name: string; fields: Array<{ name: string; label: string }> }>;
  onChange: (f: FieldSpec) => void;
  onSameRow: (v: boolean) => void;
}

const INPUT_TYPES = PALETTE.filter((p) => !['section', 'content', 'pagebreak'].includes(p.type));
const OPS = [
  { v: '=', label: 'is' }, { v: '!=', label: 'is not' }, { v: '>', label: 'more than' }, { v: '<', label: 'less than' },
  { v: 'contains', label: 'contains' }, { v: 'is empty', label: 'is empty' }, { v: 'is not empty', label: 'is not empty' },
];

function literal(v: string): string {
  if (/^(true|false)$/i.test(v.trim()) || /^-?\d+(\.\d+)?$/.test(v.trim())) return v.trim().toLowerCase();
  return `"${v.replace(/"/g, '')}"`;
}

export function showWhenProblem(expr: string, names: Set<string>): string | null {
  if (!expr.trim()) return null;
  try {
    const r = parseShowWhen(expr);
    const unknown = r.fields.find((f) => !names.has(f));
    return unknown ? `Unknown field ${unknown}.` : null;
  } catch (e) {
    return (e as Error).message;
  }
}

export function FieldPanel(p: PanelProps) {
  const f = p.field as AnyField;
  const set = (patch: Record<string, unknown>) => {
    const next = { ...f, ...patch } as AnyField;
    for (const [k, v] of Object.entries(patch)) if (v === undefined || v === '' || v === false) delete next[k];
    p.onChange(next as FieldSpec);
  };
  const id = (k: string) => `fp-${k}`;
  const isInput = 'name' in f && f.type !== 'section' && f.type !== 'table';
  const text = (k: string, label: string, opts: { area?: boolean; help?: string } = {}) => (
    <div>
      <Label htmlFor={id(k)}>{label}</Label>
      {opts.area ? (
        <Textarea id={id(k)} rows={3} value={(f[k] as string | undefined) ?? ''} onChange={(e) => set({ [k]: e.target.value })} />
      ) : (
        <Input id={id(k)} value={(f[k] as string | undefined) ?? ''} onChange={(e) => set({ [k]: e.target.value })} autoComplete="off" />
      )}
      {opts.help ? <p className="mt-1 text-small text-fg-muted">{opts.help}</p> : null}
    </div>
  );
  const num = (k: string, label: string) => (
    <div>
      <Label htmlFor={id(k)}>{label}</Label>
      <Input
        id={id(k)} inputMode="decimal" value={f[k] === undefined ? '' : String(f[k])}
        onChange={(e) => set({ [k]: e.target.value.trim() === '' || Number.isNaN(Number(e.target.value)) ? undefined : Number(e.target.value) })}
      />
    </div>
  );
  const check = (k: string, label: string, disabled = false) => (
    <label className="flex min-h-11 items-center gap-2 text-body">
      <input type="checkbox" className="size-5" checked={!!f[k]} disabled={disabled} onChange={(e) => set({ [k]: e.target.checked })} />
      {label}
    </label>
  );

  return (
    <div className="space-y-4" data-testid="field-panel">
      {isInput ? (
        <div>
          <Label htmlFor={id('label')}>Label</Label>
          <Input
            id={id('label')} value={String(f.label ?? '')} autoComplete="off"
            onChange={(e) => {
              const label = e.target.value;
              const patch: Record<string, unknown> = { label };
              if (!p.nameFixed) patch.name = fieldNameFromLabel(label, p.others.map((o) => o.name));
              set(patch);
            }}
          />
          <p className="mt-1 text-small text-fg-muted">
            Saved as <span className="font-mono">{String(f.name)}</span>
            {p.nameFixed ? ' (fixed: the form is published with this field)' : ' (follows the label until published)'}
          </p>
        </div>
      ) : null}

      {isInput ? (
        <div>
          <Label htmlFor={id('type')}>Type</Label>
          <Select
            id={id('type')} value={f.type}
            onChange={(e) => {
              const fresh = newField(e.target.value as PaletteType, []) as AnyField;
              const keep = ['name', 'label', 'help', 'required', 'readOnly', 'internalOnly', 'showWhen', 'hideLabel', 'row', 'col', 'span'];
              const next = { ...fresh } as AnyField;
              for (const k of keep) if (f[k] !== undefined) next[k] = f[k];
              p.onChange(next as FieldSpec);
            }}
          >
            {INPUT_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
          </Select>
          {p.hasData ? <p className="mt-1 text-small text-fg-muted">This field has data: only a change to text or paragraph is accepted on publish.</p> : null}
        </div>
      ) : null}

      {f.type === 'section' ? (<>{text('label', 'Section title')}{text('description', 'Description', { area: true })}</>) : null}
      {f.type === 'content' ? text('html', 'Text (HTML: p, strong, em, ul/ol/li, https links)', { area: true }) : null}
      {f.type === 'pagebreak' ? (<>{text('nextButton', 'Next button')}{text('pageTitle', 'Title of the page above')}{check('showBackButton', 'Back button on the page above')}</>) : null}

      {f.type !== 'pagebreak' ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor={id('width')}>Width</Label>
            <Select id={id('width')} value={widthOf(p.field)} onChange={(e) => set({ span: WIDTH_SPAN[e.target.value as Width] })}>
              <option value="full">Full</option><option value="half">1/2</option><option value="third">1/3</option><option value="quarter">1/4</option>
            </Select>
          </div>
          <label className="flex min-h-11 items-end gap-2 pb-2 text-body">
            <input type="checkbox" className="size-5" checked={p.sameRow} onChange={(e) => p.onSameRow(e.target.checked)} />
            Same row as previous
          </label>
        </div>
      ) : null}

      {isInput ? (
        <>
          {text('help', 'Help text (under the field)')}
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            {check('required', 'Required')}
            {check('hideLabel', 'Hide label')}
            {check('readOnly', 'Read-only for the public')}
            {check('internalOnly', 'Internal only (staff)')}
          </div>
        </>
      ) : null}

      {['text', 'textarea', 'email', 'phone', 'url', 'number', 'currency'].includes(f.type) ? text('placeholder', 'Placeholder') : null}
      {f.type === 'text' || f.type === 'textarea' ? <div className="grid grid-cols-2 gap-3">{num('minLength', 'Min length')}{num('maxLength', 'Max length')}</div> : null}
      {f.type === 'text' ? (
        <div>
          <Label htmlFor={id('pattern')}>Pattern</Label>
          <Select id={id('pattern')} value={String(f.pattern ?? 'none')} onChange={(e) => set({ pattern: e.target.value === 'none' ? undefined : e.target.value })}>
            <option value="none">None</option><option value="alphanumeric">Letters and numbers</option><option value="uppercase">Upper case</option>
          </Select>
        </div>
      ) : null}
      {f.type === 'textarea' ? num('rows', 'Rows') : null}
      {f.type === 'number' ? (<><div className="grid grid-cols-2 gap-3">{num('min', 'Min')}{num('max', 'Max')}</div>{check('integer', 'Whole numbers only')}{num('default', 'Default')}</>) : null}
      {f.type === 'currency' ? (<><div className="grid grid-cols-2 gap-3">{num('min', 'Min')}{num('max', 'Max')}</div>{text('currency', 'Currency code (blank = org currency)')}{num('default', 'Default amount')}</>) : null}
      {f.type === 'date' ? (<><div className="grid grid-cols-2 gap-3">{text('min', 'Earliest (YYYY-MM-DD)')}{text('max', 'Latest (YYYY-MM-DD)')}</div>{text('default', 'Default (today or YYYY-MM-DD)')}</>) : null}
      {f.type === 'time' ? (<><div className="grid grid-cols-2 gap-3">{text('min', 'Earliest (HH:MM)')}{text('max', 'Latest (HH:MM)')}</div>{text('default', 'Default (now or HH:MM)')}</>) : null}
      {f.type === 'datetime' ? (
        <label className="flex min-h-11 items-center gap-2 text-body">
          <input type="checkbox" className="size-5" checked={f.default === 'now'} onChange={(e) => set({ default: e.target.checked ? 'now' : undefined })} />
          Default to now
        </label>
      ) : null}
      {['text', 'textarea', 'email', 'phone', 'url'].includes(f.type) ? text('default', 'Default') : null}
      {f.type === 'rating' ? num('default', 'Default (1-5)') : null}
      {f.type === 'yesno' ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor={id('style')}>Style</Label>
            <Select id={id('style')} value={String(f.style ?? 'radio')} onChange={(e) => set({ style: e.target.value })}>
              <option value="radio">Yes / No</option><option value="toggle">Switch</option>
            </Select>
          </div>
          <div>
            <Label htmlFor={id('default')}>Default</Label>
            <Select id={id('default')} value={f.default === undefined ? '' : f.default ? 'yes' : 'no'} onChange={(e) => set({ default: e.target.value === '' ? undefined : e.target.value === 'yes' })}>
              <option value="">None</option><option value="yes">Yes</option><option value="no">No</option>
            </Select>
          </div>
        </div>
      ) : null}
      {f.type === 'choice' ? <ChoiceOptions field={f} set={set} /> : null}
      {f.type === 'file' ? (<>{check('multi', 'Several files')}{num('maxFiles', 'Most files')}{text('accept', 'Accepted types (e.g. image/*,.pdf)')}</>) : null}
      {f.type === 'lookup' ? <LookupOptions field={f} forms={p.forms} set={set} /> : null}

      {f.type !== 'pagebreak' ? <ShowWhen field={f} others={p.others} set={set} /> : null}
    </div>
  );
}

function ChoiceOptions({ field, set }: { field: AnyField; set: (patch: Record<string, unknown>) => void }) {
  const [text, setText] = useState(((field.options as string[]) ?? []).join('\n'));
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="fp-options">Options (one per line)</Label>
        <Textarea
          id="fp-options" rows={4} value={text}
          onChange={(e) => {
            setText(e.target.value);
            const options = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
            if (options.length) set({ options });
          }}
        />
      </div>
      <div>
        <Label htmlFor="fp-cstyle">Show as</Label>
        <Select id="fp-cstyle" value={String(field.style)} onChange={(e) => set({ style: e.target.value, multi: e.target.value === 'checkboxes' ? true : undefined })}>
          <option value="dropdown">Dropdown</option><option value="radio">Buttons (one)</option><option value="checkboxes">Checkboxes (several)</option>
        </Select>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-body">
        <input type="checkbox" className="size-5" checked={!!field.other} onChange={(e) => set({ other: e.target.checked })} />
        &quot;Other&quot; option with a text box
      </label>
      <div>
        <Label htmlFor="fp-cdefault">Default</Label>
        <Select id="fp-cdefault" value={String(field.default ?? '')} onChange={(e) => set({ default: e.target.value || undefined })}>
          <option value="">None</option>
          {((field.options as string[]) ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      </div>
    </div>
  );
}

function LookupOptions({ field, forms, set }: { field: AnyField; forms: PanelProps['forms']; set: (patch: Record<string, unknown>) => void }) {
  const lk = (field.lookup as { sourceForm: string; displayField: string }) ?? { sourceForm: '', displayField: '' };
  const src = forms.find((f) => f.slug === lk.sourceForm);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor="fp-lsrc">Look up entries of</Label>
        <Select id="fp-lsrc" value={lk.sourceForm} onChange={(e) => set({ lookup: { sourceForm: e.target.value, displayField: '' } })}>
          <option value="">Choose a form</option>
          {forms.map((f) => <option key={f.slug} value={f.slug}>{f.name}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor="fp-lfield">Show field</Label>
        <Select id="fp-lfield" value={lk.displayField} onChange={(e) => set({ lookup: { ...lk, displayField: e.target.value } })}>
          <option value="">Choose a field</option>
          {(src?.fields ?? []).map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
        </Select>
      </div>
    </div>
  );
}

function ShowWhen({ field, others, set }: { field: AnyField; others: PanelProps['others']; set: (patch: Record<string, unknown>) => void }) {
  const [src, setSrc] = useState(others[0]?.name ?? '');
  const [op, setOp] = useState('=');
  const [value, setValue] = useState('');
  const expr = String(field.showWhen ?? '');
  const problem = showWhenProblem(expr, new Set(others.map((o) => o.name)));
  return (
    <fieldset className="space-y-3 rounded-sm border border-border p-3">
      <legend className="px-1 text-small font-semibold text-fg">Show when</legend>
      <p className="text-small text-fg-muted">Hidden fields are not checked and not saved. Leave empty to always show.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <label htmlFor="sw-field" className="sr-only">Field</label>
          <Select id="sw-field" value={src} onChange={(e) => setSrc(e.target.value)}>
            {others.map((o) => <option key={o.name} value={o.name}>{o.label || o.name}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="sw-op" className="sr-only">Condition</label>
          <Select id="sw-op" value={op} onChange={(e) => setOp(e.target.value)}>
            {OPS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </Select>
        </div>
        {op === 'is empty' || op === 'is not empty' ? null : (
          <div>
            <label htmlFor="sw-value" className="sr-only">Value</label>
            <Input id="sw-value" placeholder="Value (true / false for Yes/No)" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button" className={buttonClass('secondary', 32)} disabled={!src}
          onClick={() => {
            const clause = op === 'is empty' || op === 'is not empty' ? `${src} ${op}` : `${src} ${op} ${literal(value)}`;
            set({ showWhen: clause });
          }}
        >
          Set rule
        </button>
        {expr ? (
          <button
            type="button" className={buttonClass('secondary', 32)}
            onClick={() => {
              const clause = op === 'is empty' || op === 'is not empty' ? `${src} ${op}` : `${src} ${op} ${literal(value)}`;
              set({ showWhen: `${expr} AND ${clause}` });
            }}
          >
            Add as AND
          </button>
        ) : null}
        {expr ? <button type="button" className={buttonClass('ghost', 32)} onClick={() => set({ showWhen: undefined })}>Clear</button> : null}
      </div>
      <div>
        <Label htmlFor="fp-showWhen">Rule</Label>
        <Input
          id="fp-showWhen" value={expr} placeholder='e.g. Urgent = true OR Colour = "Red"' className="font-mono"
          aria-invalid={problem ? true : undefined} aria-describedby={problem ? 'fp-showWhen-err' : undefined}
          onChange={(e) => set({ showWhen: e.target.value })}
        />
        {problem ? <p id="fp-showWhen-err" className="mt-1 text-small text-status-red-fg">{problem}</p> : null}
      </div>
    </fieldset>
  );
}
