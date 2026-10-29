'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  name: string;
  label: string;
  existing?: { id: string; url?: string | null } | null;
  error?: string;
  disabled?: boolean;
}

/**
 * Draw-to-sign pad. Posts sig.<Field> as a PNG data URL, "keep:<fileId>" for an untouched existing
 * signature, or "" when cleared. Pointer events cover mouse, pen and touch (factory phones).
 */
export function SignaturePad({ name, label, existing, error, disabled }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [value, setValue] = useState(existing ? `keep:${existing.id}` : '');
  const [mode, setMode] = useState<'existing' | 'draw'>(existing ? 'existing' : 'draw');

  useEffect(() => {
    const c = canvas.current;
    if (!c || mode !== 'draw') return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111';
  }, [mode]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        {!disabled && mode === 'draw' ? (
          <button
            type="button"
            className="text-xs text-fg-muted underline"
            onClick={() => {
              const c = canvas.current!;
              c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
              setValue('');
            }}
          >
            Clear
          </button>
        ) : null}
        {!disabled && mode === 'existing' ? (
          <button type="button" className="text-xs text-fg-muted underline" onClick={() => { setMode('draw'); setValue(''); }}>
            Sign again
          </button>
        ) : null}
      </div>
      {mode === 'existing' ? (
        <div className="flex h-32 items-center justify-center rounded border bg-surface">
          {existing?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={existing.url} alt={`${label} (signed)`} className="max-h-28" />
          ) : (
            <span className="text-sm text-fg-muted">Signed</span>
          )}
        </div>
      ) : (
        <canvas
          ref={canvas}
          aria-label={`${label}: draw your signature`}
          data-testid={`sig-${name}`}
          className={`h-32 w-full touch-none rounded border bg-surface ${error ? 'border-danger' : ''}`}
          onPointerDown={(e) => {
            if (disabled) return;
            drawing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            const ctx = e.currentTarget.getContext('2d')!;
            const [x, y] = pos(e);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 0.1, y + 0.1);
            ctx.stroke();
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = e.currentTarget.getContext('2d')!;
            const [x, y] = pos(e);
            ctx.lineTo(x, y);
            ctx.stroke();
          }}
          onPointerUp={(e) => {
            if (!drawing.current) return;
            drawing.current = false;
            setValue(e.currentTarget.toDataURL('image/png'));
          }}
        />
      )}
      <input type="hidden" name={`sig.${name}`} value={value} />
      {error ? <p className="mt-1 text-sm text-status-red-fg">{error}</p> : null}
    </div>
  );
}
