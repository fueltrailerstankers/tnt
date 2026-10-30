'use client';

import { useRef, type KeyboardEvent } from 'react';
import { TASK_FILTERS, type TaskCounts, type TaskFilter } from '@/lib/tasks/build';

export const PANEL_ID = 'tasks-panel';
export const tabId = (f: TaskFilter) => `tasks-tab-${f}`;

/**
 * Filter chips as a tablist (design Tasks): one chip per category the member can see, each with its live count.
 * Arrow keys move and select, Home/End jump; only the selected chip is in the tab order.
 */
export function TaskFilters({ filters, value, counts, onChange }: {
  filters: readonly TaskFilter[]; value: TaskFilter; counts: TaskCounts; onChange: (f: TaskFilter) => void;
}) {
  const refs = useRef(new Map<TaskFilter, HTMLButtonElement>());
  const items = TASK_FILTERS.filter((f) => filters.includes(f.value));

  const move = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = items.findIndex((f) => f.value === value);
    const to = e.key === 'ArrowRight' ? (i + 1) % items.length
      : e.key === 'ArrowLeft' ? (i - 1 + items.length) % items.length
        : e.key === 'Home' ? 0
          : e.key === 'End' ? items.length - 1
            : -1;
    if (to < 0) return;
    e.preventDefault();
    const next = items[to].value;
    onChange(next);
    refs.current.get(next)?.focus();
  };

  return (
    <div role="tablist" aria-label="Filter tasks" className="flex flex-wrap gap-2">
      {items.map((f) => {
        const on = f.value === value;
        return (
          <button
            key={f.value}
            ref={(el) => {
              if (el) refs.current.set(f.value, el);
              else refs.current.delete(f.value);
            }}
            type="button"
            role="tab"
            id={tabId(f.value)}
            aria-selected={on}
            aria-controls={PANEL_ID}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(f.value)}
            onKeyDown={move}
            className={`inline-flex h-11 items-center gap-1.5 rounded-pill border px-3 text-small font-semibold transition lg:h-8 ${on ? 'border-fg bg-fg text-bg' : 'border-border bg-surface text-fg hover:bg-surface-2'}`}
          >
            {f.label}
            <span className="sr-only">, </span>
            <span className="font-mono font-medium">{counts[f.value]}</span>
          </button>
        );
      })}
    </div>
  );
}
