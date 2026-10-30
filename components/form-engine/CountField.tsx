'use client';

import { Icon } from '@/components/ui/Icon';
import { shortBy } from '@/lib/spec/presentation';
import { errorCls, inputCls } from './styles';

/**
 * Store Room count. The minimum written in the label is shown beside it; a count below it turns red with
 * "Short by N". Phones get +/- steppers (48px). Posts f.<Field> as text, as the spec defines.
 */
export function CountField({ id, name, label, min, value, onChange, err, disabled }: {
  id: string; name: string; label: string; min: number | null; value: string; onChange: (v: string) => void; err?: string; disabled?: boolean;
}) {
  const short = shortBy(value, min);
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const step = (d: number) => {
    const n = Number(value.trim() || '0');
    onChange(String(Math.max(0, (Number.isFinite(n) ? n : 0) + d)));
  };
  const btn = 'flex size-12 flex-none items-center justify-center rounded-full border border-border-strong bg-surface text-fg disabled:opacity-50 sm:hidden';
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-small font-semibold text-fg">{label}</label>
        {min !== null ? <span id={hintId} className="whitespace-nowrap text-label font-medium tracking-normal text-fg-muted">min {min}</span> : null}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} aria-label="Decrease by 1" aria-controls={id} disabled={disabled} onClick={() => step(-1)}>
          <Icon name="minus" size={18} strokeWidth={2} />
        </button>
        <input
          id={id}
          name={`f.${name}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          aria-invalid={err || short ? true : undefined}
          aria-describedby={[min !== null ? hintId : '', short || err ? errId : ''].filter(Boolean).join(' ') || undefined}
          className={inputCls(err || short > 0, `text-right font-mono ${short ? 'bg-status-red-bg' : ''}`)}
        />
        <button type="button" className={btn} aria-label="Increase by 1" aria-controls={id} disabled={disabled} onClick={() => step(1)}>
          <Icon name="plus" size={18} strokeWidth={2} />
        </button>
      </div>
      {err ? <p id={errId} className={errorCls}>{err}</p> : short ? <p id={errId} className={errorCls}>Short by {short}</p> : null}
    </div>
  );
}
