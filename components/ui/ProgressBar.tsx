/** Determinate progress (value of max). Track and fill use tokens; `onDark` for charcoal headers. */
export function ProgressBar({ value, max, label, onDark = false, className = '' }: { value: number; max: number; label: string; onDark?: boolean; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`h-1.5 w-full overflow-hidden rounded-pill ${onDark ? 'bg-side-active' : 'bg-surface-2'} ${className}`}
    >
      <div className="h-full rounded-pill bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}
