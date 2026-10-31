import { Icon } from '@/components/ui/Icon';
import type { FlowStep } from '@/lib/entry-view/status';
import { DOT_FILL, STEP_STATE_TEXT } from './tone';

/** Vertical status flow (design StoreRoom aside): Submitted (archived) → APPROVAL → APPROVED EMAILED. */
export function StatusFlow({ steps }: { steps: FlowStep[] }) {
  return (
    <ol aria-label="Status flow" className="m-0 flex list-none flex-col gap-2.5 p-0">
      {steps.map((s) => (
        <li
          key={s.status}
          aria-current={s.state === 'current' ? 'step' : undefined}
          className={`flex items-center gap-2.5 text-body ${s.state === 'current' ? 'font-bold text-fg' : 'text-fg-muted'}`}
        >
          <span
            aria-hidden="true"
            className={`flex size-[22px] flex-none items-center justify-center rounded-full text-[11px] font-bold ${
              s.state === 'todo' ? 'border border-border-strong text-fg-muted' : DOT_FILL[s.tone]
            }`}
          >
            {s.state === 'done' ? <Icon name="check" size={13} strokeWidth={3} /> : s.n}
          </span>
          <span>{s.label}</span>
          <span className="sr-only"> ({STEP_STATE_TEXT[s.state]})</span>
        </li>
      ))}
    </ol>
  );
}
