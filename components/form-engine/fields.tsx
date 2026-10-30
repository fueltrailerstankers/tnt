'use client';

// M8 field inputs: choice with "Other" and real radios, yes/no, rating, currency, section heading.
// Phone friendly: 20px controls inside ≥44px tap rows, native inputs where the phone keyboard helps.
import { useState } from 'react';
import { OTHER_VALUE } from '@/lib/spec/values';
import { a11y, ErrorText, HelpText, inputCls, Label, Legend } from './parts';

interface Common {
  id: string;
  name: string;
  label: string;
  err?: string;
  help?: string;
  required?: boolean;
  /** Public role on a readOnly field: shown, not editable (the server keeps the saved value anyway). */
  locked?: boolean;
}

const optionRow = 'flex min-h-11 items-center gap-2 text-sm';
const box = 'h-5 w-5 shrink-0';

/** Choice with radio buttons and/or an "Other" option. (Dropdown/checkbox choices without Other keep the kit markup.) */
export function ChoiceInput(p: Common & { style: 'dropdown' | 'checkboxes' | 'radio'; multi: boolean; options: string[]; other: boolean; value: unknown }) {
  const values = Array.isArray(p.value) ? (p.value as unknown[]).map(String) : p.value === undefined || p.value === null || p.value === '' ? [] : [String(p.value)];
  const known = values.filter((v) => p.options.includes(v));
  const extra = p.other ? values.find((v) => !p.options.includes(v)) : undefined;
  const [otherOn, setOtherOn] = useState(extra !== undefined);
  const [otherText, setOtherText] = useState(extra ?? '');
  const attrs = a11y(p.id, p.err, p.help, p.required);
  const otherBox = p.other && otherOn ? (
    <div className="mt-2">
      <label htmlFor={`${p.id}-other`} className="text-xs text-fg-muted">Other (please specify)</label>
      <input id={`${p.id}-other`} name={`f.${p.name}.other`} value={otherText} onChange={(e) => setOtherText(e.target.value)} autoComplete="off" readOnly={p.locked || undefined} className={inputCls(p.err)} />
    </div>
  ) : null;

  if (p.multi || p.style === 'checkboxes' || p.style === 'radio') {
    const type = p.multi || p.style === 'checkboxes' ? 'checkbox' : 'radio';
    // aria-required is valid on a radiogroup, not on a plain group of checkboxes.
    const groupAttrs = type === 'radio' ? { role: 'radiogroup', ...attrs } : a11y(p.id, p.err, p.help, false);
    return (
      <fieldset {...groupAttrs}>
        <Legend text={p.label} required={p.required} />
        <div className="flex flex-wrap gap-x-4">
          {p.options.map((o) => (
            <label key={o} className={optionRow}>
              <input
                type={type} name={`f.${p.name}`} value={o} defaultChecked={known.includes(o)} disabled={p.locked} className={box}
                onChange={type === 'radio' ? () => setOtherOn(false) : undefined}
              />
              {o}
            </label>
          ))}
          {p.other ? (
            <label className={optionRow}>
              <input
                type={type} name={`f.${p.name}`} value={OTHER_VALUE} defaultChecked={extra !== undefined} disabled={p.locked} className={box}
                onChange={(e) => setOtherOn(e.target.checked)}
              />
              Other
            </label>
          ) : null}
        </div>
        {otherBox}
        <HelpText text={p.help} id={`${p.id}-help`} />
        <ErrorText msg={p.err} id={`${p.id}-err`} />
      </fieldset>
    );
  }
  return (
    <div>
      <Label htmlFor={p.id} text={p.label} required={p.required} />
      <select
        id={p.id} name={`f.${p.name}`} defaultValue={extra !== undefined ? OTHER_VALUE : (known[0] ?? '')} disabled={p.locked}
        onChange={(e) => setOtherOn(e.target.value === OTHER_VALUE)} className={inputCls(p.err)} {...attrs}
      >
        <option value="" />
        {p.options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
        <option value={OTHER_VALUE}>Other</option>
      </select>
      {otherBox}
      <HelpText text={p.help} id={`${p.id}-help`} />
      <ErrorText msg={p.err} id={`${p.id}-err`} />
    </div>
  );
}

/** Yes/No: radio pair (default) or a switch. Posts "yes" / "no" ("yes" or nothing for the switch). */
export function YesNoInput(p: Common & { style?: 'radio' | 'toggle'; value: unknown }) {
  const attrs = a11y(p.id, p.err, p.help, p.required);
  if (p.style === 'toggle') {
    return (
      <div>
        <label htmlFor={p.id} className={`${optionRow} font-medium`}>
          <input id={p.id} type="checkbox" role="switch" name={`f.${p.name}`} value="yes" defaultChecked={p.value === true} disabled={p.locked} className={box} {...attrs} />
          {p.label}
          {p.required ? <span aria-hidden="true" className="text-status-red-fg"> *</span> : null}
        </label>
        <HelpText text={p.help} id={`${p.id}-help`} />
        <ErrorText msg={p.err} id={`${p.id}-err`} />
      </div>
    );
  }
  return (
    <fieldset role="radiogroup" {...attrs}>
      <Legend text={p.label} required={p.required} />
      <div className="flex gap-6">
        {(['yes', 'no'] as const).map((v) => (
          <label key={v} className={optionRow}>
            <input type="radio" name={`f.${p.name}`} value={v} defaultChecked={p.value === (v === 'yes')} disabled={p.locked} className={box} />
            {v === 'yes' ? 'Yes' : 'No'}
          </label>
        ))}
      </div>
      <HelpText text={p.help} id={`${p.id}-help`} />
      <ErrorText msg={p.err} id={`${p.id}-err`} />
    </fieldset>
  );
}

/** 1-5 stars as a radio group (keyboard: arrow keys move between stars). */
export function RatingInput(p: Common & { value: unknown }) {
  const [value, setValue] = useState(typeof p.value === 'number' ? p.value : 0);
  const attrs = a11y(p.id, p.err, p.help, p.required);
  return (
    <fieldset role="radiogroup" {...attrs}>
      <Legend text={p.label} required={p.required} />
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="relative flex h-11 w-11 cursor-pointer items-center justify-center">
            <input
              type="radio" name={`f.${p.name}`} value={n} checked={value === n} disabled={p.locked}
              onChange={() => setValue(n)} className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <span aria-hidden="true" className={`text-2xl leading-none peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-focus ${n <= value ? 'text-accent-text' : 'text-fg-subtle'}`}>
              {n <= value ? '★' : '☆'}
            </span>
            <span className="sr-only">{n} star{n === 1 ? '' : 's'}</span>
          </label>
        ))}
        {value && !p.required && !p.locked ? (
          <button type="button" className="ml-2 text-sm underline" onClick={() => setValue(0)}>Clear</button>
        ) : null}
      </div>
      <HelpText text={p.help} id={`${p.id}-help`} />
      <ErrorText msg={p.err} id={`${p.id}-err`} />
    </fieldset>
  );
}

/** Amount with the currency code shown in front (the code is fixed per field: its own or the org's). */
export function CurrencyInput(p: Common & { currency: string; placeholder?: string; value: unknown; hideLabel?: boolean }) {
  const amount = p.value && typeof p.value === 'object' && typeof (p.value as { amount?: unknown }).amount === 'number' ? (p.value as { amount: number }).amount : undefined;
  const code = p.value && typeof p.value === 'object' && typeof (p.value as { currency?: unknown }).currency === 'string' ? (p.value as { currency: string }).currency : p.currency;
  const attrs = a11y(p.id, p.err, p.help, p.required);
  const by = [`${p.id}-cur`, attrs['aria-describedby']].filter(Boolean).join(' ');
  return (
    <div>
      <Label htmlFor={p.id} text={p.label} hidden={p.hideLabel} required={p.required} />
      <div className="flex items-stretch">
        <span id={`${p.id}-cur`} className="flex items-center rounded-l border border-r-0 border-border-strong bg-surface-2 px-3 text-sm text-fg-muted">{code}</span>
        <input
          id={p.id} name={`f.${p.name}`} type="text" inputMode="decimal" placeholder={p.placeholder} autoComplete="off"
          defaultValue={amount === undefined ? '' : amount.toFixed(2)} readOnly={p.locked || undefined}
          className={`${inputCls(p.err)} rounded-l-none`} {...attrs} aria-describedby={by}
        />
      </div>
      <HelpText text={p.help} id={`${p.id}-help`} />
      <ErrorText msg={p.err} id={`${p.id}-err`} />
    </div>
  );
}

/** Section heading (M8): groups the fields after it. */
export function SectionHeading({ id, title, description }: { id: string; title: string; description?: string }) {
  return (
    <div className="border-b border-border pb-2 pt-2">
      <h2 id={id} className="text-h2">{title}</h2>
      {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
    </div>
  );
}
