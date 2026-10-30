'use client';

// M8 field controls, in the UI handoff's style (components/form-engine/styles.ts, pills like the kit choices):
// choice with "Other", yes/no (pills or a switch), rating (stars), currency (amount + code). Phone friendly:
// 44px+ tap targets below 640px.
import { useState } from 'react';
import { OTHER_VALUE } from '@/lib/spec/values';
import { a11y, ErrorText, FieldLabel, HelpText, Legend } from './parts';
import { inputCls, partLabelCls } from './styles';

/** The kit choice pill (radio/checkbox) and its input, shared so every option looks the same. */
export const pillCls =
  'inline-flex h-11 cursor-pointer items-center gap-2 rounded-pill border border-border-strong bg-surface px-3.5 text-body font-medium text-fg transition hover:bg-surface-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus sm:h-10';
export const pillInputCls = 'size-4 accent-[var(--accent)]';

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

/** Choice with an "Other" option (free text). Choices without "Other" keep the kit markup in FormRenderer. */
export function ChoiceInput(p: Common & { style: 'dropdown' | 'checkboxes' | 'radio'; multi: boolean; options: string[]; value: unknown }) {
  const values = Array.isArray(p.value) ? (p.value as unknown[]).map(String) : p.value === undefined || p.value === null || p.value === '' ? [] : [String(p.value)];
  const known = values.filter((v) => p.options.includes(v));
  const extra = values.find((v) => !p.options.includes(v));
  const [otherOn, setOtherOn] = useState(extra !== undefined);
  const [otherText, setOtherText] = useState(extra ?? '');
  const otherBox = otherOn ? (
    <div className="mt-3">
      <label htmlFor={`${p.id}-other`} className={partLabelCls}>Other (please specify)</label>
      <input
        id={`${p.id}-other`} name={`f.${p.name}.other`} value={otherText} onChange={(e) => setOtherText(e.target.value)}
        autoComplete="off" readOnly={p.locked || undefined} className={inputCls(p.err)}
      />
    </div>
  ) : null;

  if (p.multi || p.style !== 'dropdown') {
    const radio = p.style === 'radio' && !p.multi;
    const type = radio ? 'radio' : 'checkbox';
    // aria-required is valid on a radiogroup, not on a plain group of checkboxes.
    const attrs = radio ? { role: 'radiogroup', ...a11y(p.id, p.err, p.help, p.required) } : a11y(p.id, p.err, p.help, false);
    return (
      <fieldset {...attrs}>
        <Legend text={p.label} required={p.required} />
        <div className="flex flex-wrap gap-2">
          {p.options.map((o) => (
            <label key={o} className={pillCls}>
              <input
                type={type} name={`f.${p.name}`} value={o} defaultChecked={known.includes(o)} disabled={p.locked} className={pillInputCls}
                onChange={radio ? () => setOtherOn(false) : undefined}
              />
              {o}
            </label>
          ))}
          <label className={pillCls}>
            <input type={type} name={`f.${p.name}`} value={OTHER_VALUE} defaultChecked={extra !== undefined} disabled={p.locked} className={pillInputCls} onChange={(e) => setOtherOn(e.target.checked)} />
            Other
          </label>
        </div>
        {otherBox}
        <HelpText text={p.help} id={`${p.id}-help`} />
        <ErrorText msg={p.err} id={`${p.id}-err`} />
      </fieldset>
    );
  }
  return (
    <div>
      <FieldLabel htmlFor={p.id} text={p.label} required={p.required} />
      <select
        id={p.id} name={`f.${p.name}`} defaultValue={extra !== undefined ? OTHER_VALUE : (known[0] ?? '')} disabled={p.locked}
        onChange={(e) => setOtherOn(e.target.value === OTHER_VALUE)} className={inputCls(p.err, 'appearance-none pr-10')} {...a11y(p.id, p.err, p.help, p.required)}
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

/** Yes/No: two pills (default) or a switch. Posts "yes" / "no" ("yes" or nothing for the switch). */
export function YesNoInput(p: Common & { style?: 'radio' | 'toggle'; value: unknown }) {
  const attrs = a11y(p.id, p.err, p.help, p.required);
  if (p.style === 'toggle') {
    return (
      <div>
        <label htmlFor={p.id} className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-body font-semibold text-fg">
          <span className="relative inline-flex h-6 w-11 flex-none items-center rounded-pill border border-border-strong bg-surface-2 transition has-[:checked]:border-accent has-[:checked]:bg-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus">
            <input
              id={p.id} type="checkbox" role="switch" name={`f.${p.name}`} value="yes" defaultChecked={p.value === true} disabled={p.locked}
              className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" {...attrs}
            />
            <span aria-hidden="true" className="ml-0.5 size-5 rounded-pill bg-surface shadow-card transition peer-checked:translate-x-5" />
          </span>
          <span>
            {p.label}
            {p.required ? <span className="ml-0.5 text-danger" aria-hidden="true">*</span> : null}
          </span>
        </label>
        <HelpText text={p.help} id={`${p.id}-help`} />
        <ErrorText msg={p.err} id={`${p.id}-err`} />
      </div>
    );
  }
  return (
    <fieldset role="radiogroup" {...attrs}>
      <Legend text={p.label} required={p.required} />
      <div className="flex flex-wrap gap-2">
        {(['yes', 'no'] as const).map((v) => (
          <label key={v} className={pillCls}>
            <input type="radio" name={`f.${p.name}`} value={v} defaultChecked={p.value === (v === 'yes')} disabled={p.locked} className={pillInputCls} />
            {v === 'yes' ? 'Yes' : 'No'}
          </label>
        ))}
      </div>
      <HelpText text={p.help} id={`${p.id}-help`} />
      <ErrorText msg={p.err} id={`${p.id}-err`} />
    </fieldset>
  );
}

/** 1-5 stars as a radio group (arrow keys move between stars). */
export function RatingInput(p: Common & { value: unknown }) {
  const [value, setValue] = useState(typeof p.value === 'number' ? p.value : 0);
  return (
    <fieldset role="radiogroup" {...a11y(p.id, p.err, p.help, p.required)}>
      <Legend text={p.label} required={p.required} />
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-pill has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus">
            <input
              type="radio" name={`f.${p.name}`} value={n} checked={value === n} disabled={p.locked}
              onChange={() => setValue(n)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            />
            <span aria-hidden="true" className={`text-2xl leading-none ${n <= value ? 'text-accent-text' : 'text-fg-subtle'}`}>{n <= value ? '★' : '☆'}</span>
            <span className="sr-only">{n} star{n === 1 ? '' : 's'}</span>
          </label>
        ))}
        {value && !p.required && !p.locked ? (
          <button type="button" className="ml-2 text-small font-medium text-fg-muted underline underline-offset-2" onClick={() => setValue(0)}>Clear</button>
        ) : null}
      </div>
      <HelpText text={p.help} id={`${p.id}-help`} />
      <ErrorText msg={p.err} id={`${p.id}-err`} />
    </fieldset>
  );
}

/** Amount with its currency code in front (the field's own code, or the org's). */
export function CurrencyInput(p: Common & { currency: string; placeholder?: string; value: unknown; hideLabel?: boolean }) {
  const o = p.value && typeof p.value === 'object' ? (p.value as { amount?: unknown; currency?: unknown }) : {};
  const amount = typeof o.amount === 'number' ? o.amount : undefined;
  const code = typeof o.currency === 'string' ? o.currency : p.currency;
  const attrs = a11y(p.id, p.err, p.help, p.required);
  const by = [`${p.id}-cur`, attrs['aria-describedby']].filter(Boolean).join(' ');
  return (
    <div>
      <FieldLabel htmlFor={p.id} text={p.label} hidden={p.hideLabel} required={p.required} />
      <div className="flex items-stretch">
        <span id={`${p.id}-cur`} className="flex h-12 flex-none items-center rounded-l-sm border border-r-0 border-border-strong bg-surface-2 px-3 font-mono text-small text-fg-muted sm:h-10">{code}</span>
        <input
          id={p.id} name={`f.${p.name}`} type="text" inputMode="decimal" placeholder={p.placeholder ?? '0.00'} autoComplete="off"
          defaultValue={amount === undefined ? '' : amount.toFixed(2)} readOnly={p.locked || undefined}
          className={inputCls(p.err, 'rounded-l-none text-right font-mono')} {...attrs} aria-describedby={by}
        />
      </div>
      <HelpText text={p.help} id={`${p.id}-help`} />
      <ErrorText msg={p.err} id={`${p.id}-err`} />
    </div>
  );
}
