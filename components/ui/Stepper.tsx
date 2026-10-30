'use client';

import { Icon } from './Icon';

export interface StepItem {
  label: string;
}

/**
 * Numbered step pills. Done steps show a check; earlier steps can be revisited with `onSelect`.
 * Later steps are not clickable: Next is the only way forward (it runs the step's checks).
 */
export function Stepper({ steps, current, onSelect, label = 'Form steps' }: { steps: StepItem[]; current: number; onSelect?: (index: number) => void; label?: string }) {
  return (
    <ol aria-label={label} className="flex flex-wrap gap-2">
      {steps.map((s, i) => {
        const state = i === current ? 'current' : i < current ? 'done' : 'todo';
        const body = (
          <>
            <span
              aria-hidden="true"
              className={`flex size-6 flex-none items-center justify-center rounded-full text-label tracking-normal ${
                state === 'current' ? 'bg-accent text-accent-fg' : state === 'done' ? 'bg-status-green-fg text-surface' : 'border border-border-strong text-fg-muted'
              }`}
            >
              {state === 'done' ? <Icon name="check" size={14} strokeWidth={2.5} /> : i + 1}
            </span>
            <span className="whitespace-nowrap">{s.label}</span>
          </>
        );
        const cls = `inline-flex h-9 items-center gap-2 rounded-pill pl-1.5 pr-3.5 text-small ${
          state === 'current' ? 'bg-accent-soft font-semibold text-accent-text' : 'border border-border font-medium text-fg-muted'
        }`;
        return (
          <li key={i}>
            {state === 'done' && onSelect ? (
              <button type="button" onClick={() => onSelect(i)} className={`${cls} hover:bg-surface-2`} aria-label={`Back to step ${i + 1}: ${s.label}`}>
                {body}
              </button>
            ) : (
              <span className={cls} aria-current={state === 'current' ? 'step' : undefined}>
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
