'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { bareQuoteNo, hasExactQuote, QUOTE_SEARCH_MIN, quoteOptionLabel, type QuoteOption } from '@/lib/forms/quote-fields';
import type { QuoteConfig } from './types';

// The form's quote field with the Xero quote picker. It still posts `f.<name>` as plain text, so the
// stored value and readFormData are unchanged. Free typing always works: the mirror may lag Xero.

interface Props {
  id: string;
  name: string;
  label: string;
  hideLabel?: boolean;
  value: string;
  err?: string;
  disabled?: boolean;
  config: QuoteConfig;
  inputClassName: string;
}

const DEBOUNCE_MS = 250;

export function QuoteField(p: Props) {
  const errProps = p.err ? { 'aria-invalid': true, 'aria-describedby': `${p.id}-err` } : {};
  return (
    <div>
      <label htmlFor={p.id} className={p.hideLabel ? 'sr-only' : 'mb-1 block text-sm font-medium'}>{p.label}</label>
      {p.config.mode === 'search' ? (
        <SearchInput {...p} search={p.config.search} errProps={errProps} />
      ) : (
        <CheckInput {...p} check={p.config.check} errProps={errProps} />
      )}
      {p.err ? <p id={`${p.id}-err`} className="mt-1 text-sm text-red-700">{p.err}</p> : null}
    </div>
  );
}

type InnerProps = Props & { errProps: Record<string, unknown> };

function SearchInput(p: InnerProps & { search: (q: string) => Promise<QuoteOption[]> }) {
  const listId = useId();
  const [value, setValue] = useState(p.value);
  const [options, setOptions] = useState<QuoteOption[]>([]);
  /** The value the current options answer (null = no completed search for the current value). */
  const [answered, setAnswered] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const runSearch = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < QUOTE_SEARCH_MIN) {
      seq.current += 1;
      setOptions([]);
      setAnswered(null);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      let res: QuoteOption[] = [];
      try {
        res = await p.search(term);
      } catch {
        res = [];
      }
      if (mine !== seq.current) return; // a newer keystroke won
      setOptions(res);
      setAnswered(q);
      setActive(-1);
      setOpen(res.length > 0);
    }, DEBOUNCE_MS);
  };

  const pick = (o: QuoteOption) => {
    seq.current += 1;
    if (timer.current) clearTimeout(timer.current);
    setValue(o.quoteNo);
    setOptions([o]);
    setAnswered(o.quoteNo);
    setOpen(false);
    setActive(-1);
  };

  const notFound = !!value.trim() && answered === value && !hasExactQuote(value, options);
  const showList = open && options.length > 0;
  const optId = (i: number) => `${listId}-o${i}`;

  return (
    <div className="relative">
      <input
        id={p.id}
        name={`f.${p.name}`}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? optId(active) : undefined}
        value={value}
        placeholder={p.hideLabel ? p.label : 'Quote no or customer'}
        autoComplete="off"
        disabled={p.disabled}
        className={p.inputClassName}
        onChange={(e) => {
          setValue(e.target.value);
          runSearch(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!options.length) return;
            setOpen(true);
            setActive((i) => (i + 1) % options.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (!options.length) return;
            setOpen(true);
            setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
          } else if (e.key === 'Enter') {
            // Enter picks the highlighted suggestion; it never submits the form from this field.
            e.preventDefault();
            if (showList && active >= 0 && options[active]) pick(options[active]);
          } else if (e.key === 'Escape') {
            if (showList) {
              e.preventDefault();
              setOpen(false);
              setActive(-1);
            }
          }
        }}
        onBlur={() => setOpen(false)}
        {...p.errProps}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Xero quotes"
        hidden={!showList}
        className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded border border-neutral-300 bg-white text-sm shadow-lg"
      >
        {options.map((o, i) => (
          <li
            key={o.quoteNo}
            id={optId(i)}
            role="option"
            aria-selected={i === active}
            className={`cursor-pointer px-3 py-2 ${i === active ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100'}`}
            // mousedown, not click: runs before the input's blur closes the list.
            onMouseDown={(e) => {
              e.preventDefault();
              pick(o);
            }}
            onMouseEnter={() => setActive(i)}
          >
            {quoteOptionLabel(o)}
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="mt-1 text-xs text-amber-800">{notFound ? 'Not found in Xero' : ''}</p>
    </div>
  );
}

function CheckInput(p: InnerProps & { check: (value: string) => Promise<{ found: boolean }> }) {
  const [value, setValue] = useState(p.value);
  const [result, setResult] = useState<null | { for: string; found: boolean }>(null);
  const [busy, setBusy] = useState(false);
  const current = result && result.for === value ? result : null;

  return (
    <>
      <div className="flex gap-2">
        <input
          id={p.id}
          name={`f.${p.name}`}
          type="text"
          value={value}
          placeholder={p.hideLabel ? p.label : undefined}
          autoComplete="off"
          disabled={p.disabled}
          className={p.inputClassName}
          onChange={(e) => setValue(e.target.value)}
          {...p.errProps}
        />
        <button
          type="button"
          className="rounded border px-3 disabled:opacity-60"
          disabled={p.disabled || busy || !bareQuoteNo(value)}
          onClick={async () => {
            const v = value;
            setBusy(true);
            try {
              const r = await p.check(v);
              setResult({ for: v, found: !!r?.found });
            } catch {
              setResult({ for: v, found: false });
            } finally {
              setBusy(false);
            }
          }}
        >
          Check
        </button>
      </div>
      <p aria-live="polite" className={`mt-1 text-sm ${current?.found ? 'text-green-800' : 'text-neutral-700'}`}>
        {current ? (current.found ? 'Quote found' : 'Not found in Xero (you can still submit)') : ''}
      </p>
    </>
  );
}
