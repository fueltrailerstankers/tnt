import { Icon } from '@/components/ui/Icon';
import type { StatusStep } from '@/lib/entry-view/status';
import { STEP_STATE_TEXT } from './tone';

/**
 * Horizontal status path (design EntryDetail): numbered dots joined by lines; done steps show a check on green,
 * the current one an accent ring. The state is also written out for screen readers (never colour alone).
 */
export function StatusStepper({ steps }: { steps: StatusStep[] }) {
  return (
    <ol aria-label="Status progress" className="m-0 flex list-none flex-wrap items-center gap-x-1.5 gap-y-2 p-0">
      {steps.map((s, i) => (
        <li
          key={s.label}
          aria-current={s.state === 'current' ? 'step' : undefined}
          className={`flex min-w-0 items-center gap-1.5 text-small ${i < steps.length - 1 ? 'flex-1' : ''} ${s.state === 'todo' ? 'text-fg-muted' : 'font-semibold text-fg'}`}
        >
          <span
            aria-hidden="true"
            className={`flex size-[22px] flex-none items-center justify-center rounded-full text-[11px] font-bold ${
              s.state === 'done'
                ? 'bg-status-green-fg text-surface'
                : s.state === 'current'
                  ? 'border-2 border-accent text-accent-text'
                  : 'border border-border-strong text-fg-muted'
            }`}
          >
            {s.state === 'done' ? <Icon name="check" size={13} strokeWidth={3} /> : s.n}
          </span>
          <span className="whitespace-nowrap">{s.label}</span>
          <span className="sr-only"> ({STEP_STATE_TEXT[s.state]})</span>
          {i < steps.length - 1 ? (
            <span aria-hidden="true" className={`h-0.5 min-w-3 flex-1 rounded-full ${s.state === 'done' ? 'bg-status-green-fg' : 'bg-border'}`} />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
