'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { FormSpec } from '@/lib/spec/types';
import type { ChecklistRow } from '@/lib/spec/values';
import { textareaCls } from './styles';

/**
 * Inspection checklist. Pass and Fail are independent checkboxes per row (Cognito quirk kept), shown as toggle
 * chips. The comment box opens on Fail, when a comment exists, or on request; it always posts cl.<n>.comments.
 */
export function Checklist({ spec, rows, label, disabled }: { spec: FormSpec; rows: ChecklistRow[]; label: string; disabled?: boolean }) {
  const items = spec.checklist ?? [];
  const [state, setState] = useState(() =>
    Object.fromEntries(items.map((it) => {
      const r = rows.find((x) => x.itemNo === it.itemNo);
      return [it.itemNo, { pass: !!r?.pass, fail: !!r?.fail, open: !!r?.fail || !!r?.comments }];
    })) as Record<number, { pass: boolean; fail: boolean; open: boolean }>,
  );
  const done = items.filter((it) => state[it.itemNo]?.pass || state[it.itemNo]?.fail).length;
  const failed = items.filter((it) => state[it.itemNo]?.fail).length;
  const set = (n: number, patch: Partial<{ pass: boolean; fail: boolean; open: boolean }>) => setState((s) => ({ ...s, [n]: { ...s[n], ...patch } }));

  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-h2" aria-hidden="true">{label}</h3>
        <p className="text-small text-fg-muted" aria-live="polite">
          <span className="font-mono font-semibold text-fg">{done}</span> of {items.length} checked
          {failed ? <span className="ml-2 font-semibold text-status-red-fg">· {failed} failed</span> : null}
        </p>
      </div>
      <ol className="grid gap-3 lg:grid-cols-2">
        {items.map((it) => {
          const r = rows.find((x) => x.itemNo === it.itemNo);
          const st = state[it.itemNo];
          const chip = (kind: 'pass' | 'fail') => {
            const on = st[kind];
            const tone = kind === 'pass' ? 'has-[:checked]:border-status-green-fg has-[:checked]:bg-status-green-bg has-[:checked]:text-status-green-fg' : 'has-[:checked]:border-danger has-[:checked]:bg-status-red-bg has-[:checked]:text-status-red-fg';
            return (
              <label className={`inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-pill border border-border-strong bg-surface px-4 text-body font-semibold text-fg transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${tone} ${disabled ? 'cursor-default' : ''}`}>
                <input
                  type="checkbox"
                  name={`cl.${it.itemNo}.${kind}`}
                  defaultChecked={kind === 'pass' ? r?.pass : r?.fail}
                  onChange={(e) => set(it.itemNo, kind === 'fail' ? { fail: e.target.checked, open: e.target.checked || st.open } : { pass: e.target.checked })}
                  className="size-4 accent-[var(--accent)]"
                />
                {kind === 'pass' ? 'Pass' : 'Fail'}
                {on ? <Icon name={kind === 'pass' ? 'check' : 'close'} size={14} strokeWidth={2.5} /> : null}
              </label>
            );
          };
          return (
            <li key={it.itemNo} className={`flex flex-col gap-2.5 rounded-md border bg-surface p-3.5 ${st.fail ? 'border-danger' : 'border-border'}`}>
              <p className="text-body font-medium text-fg">{it.label}</p>
              <div className="flex gap-2" role="group" aria-label={`Item ${it.itemNo} result`}>
                {chip('pass')}
                {chip('fail')}
              </div>
              {st.open ? (
                <div>
                  <label htmlFor={`cl-${it.itemNo}-c`} className="mb-1 block text-label font-medium tracking-normal text-fg-muted">
                    Comments{st.fail ? ' · what failed?' : ''}
                  </label>
                  <textarea id={`cl-${it.itemNo}-c`} name={`cl.${it.itemNo}.comments`} rows={2} defaultValue={r?.comments ?? ''} className={textareaCls()} />
                </div>
              ) : (
                <>
                  <input type="hidden" name={`cl.${it.itemNo}.comments`} value={r?.comments ?? ''} />
                  {!disabled ? (
                    <button type="button" onClick={() => set(it.itemNo, { open: true })} className="self-start text-small font-semibold text-fg-muted underline-offset-2 hover:text-fg hover:underline">
                      Add comment
                    </button>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </fieldset>
  );
}
