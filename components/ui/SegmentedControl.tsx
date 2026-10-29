'use client';

export interface Segment<T extends string> { value: T; label: string }

/** Pill-shaped single choice (Off / Dry-run / Live, Inbox / Pipeline). Radio semantics with arrow-key support from the native group. */
export function SegmentedControl<T extends string>({
  name, label, value, options, onChange, size = 36,
}: {
  name: string;
  label: string;
  value: T;
  options: Segment<T>[];
  onChange: (value: T) => void;
  size?: 36 | 44;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-pill border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <label
          key={o.value}
          className={`relative inline-flex cursor-pointer items-center rounded-pill px-4 text-small font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${size === 44 ? 'h-11' : 'h-8'} ${o.value === value ? 'bg-accent text-accent-fg' : 'text-fg-muted'}`}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}
