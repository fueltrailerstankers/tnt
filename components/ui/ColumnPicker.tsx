'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { toggleColumn } from '@/lib/ui/views';
import { Icon } from './Icon';
import { buttonClass } from './styles';

export interface ColumnOption {
  key: string;
  label: string;
  visible: boolean;
  /** Always shown ("#", "Status"): checked and disabled. */
  required?: boolean;
}

export interface ColumnPickerProps {
  columns: readonly ColumnOption[];
  /**
   * Client mode: called with the visible keys in their order on every change. Without it the checkboxes are plain
   * form fields (`name`, one value per visible column) and an Apply button submits the surrounding GET form.
   */
  onChange?: (visibleKeys: string[]) => void;
  name?: string;
  /** Locks every checkbox and shows why (encrypted forms list only number, summary and status). */
  lockedReason?: string | null;
  buttonLabel?: string;
}

/** "Columns" disclosure (details/summary) with a checkbox per column. Escape or an outside click closes it. */
export function ColumnPicker({ columns, onChange, name = 'cols', lockedReason, buttonLabel = 'Columns' }: ColumnPickerProps) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const locked = !!lockedReason;

  useEffect(() => {
    if (!open) return;
    const close = (refocus: boolean) => {
      if (details.current) details.current.open = false;
      if (refocus) summary.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(true); }
    };
    const onDown = (e: MouseEvent) => {
      if (details.current && !details.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  return (
    <details ref={details} className="relative" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary ref={summary} className={buttonClass('secondary', 32, 'cursor-pointer list-none [&::-webkit-details-marker]:hidden')}>
        <Icon name={locked ? 'lock' : 'columns'} size={15} strokeWidth={2} />
        {buttonLabel}
      </summary>
      <div
        role="group"
        aria-labelledby={headingId}
        className="absolute right-0 top-[calc(100%+6px)] z-10 flex w-60 max-w-[calc(100vw-32px)] flex-col gap-0.5 rounded-md border border-border bg-surface p-2.5 text-fg shadow-overlay"
      >
        <p id={headingId} className="m-0 px-1.5 py-1 text-[12px] font-semibold leading-4 text-fg-muted">
          {locked ? 'Columns are locked' : 'Visible columns'}
        </p>
        {locked ? <p className="m-0 px-1.5 pb-1.5 text-small text-fg-muted">{lockedReason}</p> : null}
        {columns.map((c) => {
          const disabled = locked || !!c.required;
          const control = onChange
            ? { checked: c.visible || !!c.required, onChange: (e: ChangeEvent<HTMLInputElement>) => onChange(toggleColumn(columns, c.key, e.target.checked)) }
            : { defaultChecked: c.visible || !!c.required, name, value: c.key };
          return (
            <label key={c.key} className={`flex h-8 items-center gap-2 rounded-sm px-1.5 text-body ${disabled ? 'cursor-not-allowed text-fg-muted' : 'cursor-pointer hover:bg-surface-2'}`}>
              <input type="checkbox" disabled={disabled} className="size-4 accent-accent" {...control} />
              {/* Disabled boxes are not submitted, so required columns still post their key in form mode. */}
              {!onChange && !locked && c.required ? <input type="hidden" name={name} value={c.key} /> : null}
              {c.label}
              {c.required && !locked ? <span className="sr-only"> (always shown)</span> : null}
            </label>
          );
        })}
        {!onChange && !locked ? (
          <button type="submit" className={buttonClass('primary', 30, 'mt-1.5 self-end')}>Apply</button>
        ) : null}
      </div>
    </details>
  );
}
