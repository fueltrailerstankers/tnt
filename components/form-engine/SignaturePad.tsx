'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { errorCls, labelCls, sastStamp } from './styles';

interface Props {
  name: string;
  label: string;
  existing?: { id: string; url?: string | null } | null;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  /** When set, the pad is locked and shows this reason (e.g. the terms have not been read to the end). */
  locked?: string | null;
  /** Called when a signature is captured or cleared. */
  onChange?: (signed: boolean) => void;
}

type Point = [number, number];

/**
 * Draw-to-sign pad. Posts sig.<Field> as a PNG data URL, "keep:<fileId>" for an untouched existing
 * signature, or "" when cleared. Pointer events cover mouse, pen and touch (factory phones).
 * On screen the ink follows the theme's text colour; the saved PNG always uses black ink on a transparent
 * background so the signed PDF reads the same in any theme.
 */
export function SignaturePad({ name, label, existing, error, disabled, required, locked, onChange }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef(false);
  const [value, setValue] = useState(existing ? `keep:${existing.id}` : '');
  const [mode, setMode] = useState<'existing' | 'draw'>(existing ? 'existing' : 'draw');
  const [signedAt, setSignedAt] = useState<Date | null>(null);
  const labelId = `sig-${name}-label`;
  const errId = `sig-${name}-err`;

  const redraw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const w = c.offsetWidth;
    const h = c.offsetHeight;
    if (c.width !== Math.round(w * ratio) || c.height !== Math.round(h * ratio)) {
      c.width = Math.round(w * ratio);
      c.height = Math.round(h * ratio);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = getComputedStyle(c).color;
    for (const s of strokes.current) {
      ctx.beginPath();
      s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1] + 0.1);
      ctx.stroke();
    }
  }, []);

  // Size the canvas, and redraw when the page resizes or the theme changes the ink colour.
  useEffect(() => {
    if (mode !== 'draw') return;
    redraw();
    const obs = new MutationObserver(redraw);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('resize', redraw);
    return () => {
      obs.disconnect();
      window.removeEventListener('resize', redraw);
    };
  }, [mode, redraw]);

  const exportPng = () => {
    const c = canvas.current!;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const out = document.createElement('canvas');
    out.width = c.width;
    out.height = c.height;
    const ctx = out.getContext('2d')!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'black';
    for (const s of strokes.current) {
      ctx.beginPath();
      s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1] + 0.1);
      ctx.stroke();
    }
    return out.toDataURL('image/png');
  };

  const pos = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const clear = () => {
    strokes.current = [];
    redraw();
    setValue('');
    setSignedAt(null);
    onChange?.(false);
  };

  const isLocked = !!locked && !disabled && mode === 'draw';
  const empty = mode === 'draw' && !value;
  const status = mode === 'existing' ? 'Signed' : value ? (signedAt ? `Signed ${sastStamp(signedAt)}` : 'Signed') : 'Not signed yet';

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span id={labelId} className={`${labelCls} mb-0`}>
          {label}
          {required ? <span className="ml-0.5 text-danger" aria-hidden="true">*</span> : null}
        </span>
        <span aria-live="polite" className={`text-label font-medium tracking-normal ${value ? 'text-status-green-fg' : 'text-fg-muted'}`}>
          {status}
        </span>
      </div>
      <div className={`relative overflow-hidden rounded-sm border-2 border-dashed bg-surface ${error ? 'border-danger' : value ? 'border-border' : 'border-border-strong'}`}>
        {mode === 'existing' ? (
          <div className="flex h-40 items-center justify-center p-2">
            {existing?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={existing.url} alt={`${label} (signed)`} className="ink-adapt max-h-36" />
            ) : (
              <span className="text-small text-fg-muted">Signed</span>
            )}
          </div>
        ) : (
          <>
            <canvas
              ref={canvas}
              role="img"
              aria-label={`${label}: ${value ? 'signature captured' : 'draw your signature'}`}
              aria-describedby={error ? errId : undefined}
              data-testid={`sig-${name}`}
              className={`block h-40 w-full touch-none text-fg ${disabled || isLocked ? 'cursor-not-allowed' : 'cursor-crosshair'}`}
              onPointerDown={(e) => {
                if (disabled || isLocked) return;
                drawing.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                strokes.current.push([pos(e)]);
                redraw();
              }}
              onPointerMove={(e) => {
                if (!drawing.current) return;
                strokes.current[strokes.current.length - 1].push(pos(e));
                redraw();
              }}
              onPointerUp={() => {
                if (!drawing.current) return;
                drawing.current = false;
                setValue(exportPng());
                setSignedAt(new Date());
                onChange?.(true);
              }}
            />
            <span aria-hidden="true" className="pointer-events-none absolute inset-x-6 bottom-9 border-b border-border" />
            {empty && !isLocked ? (
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-small text-fg-subtle">
                Sign here with finger or mouse
              </span>
            ) : null}
            {isLocked ? (
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-surface-2/95 px-4 text-center text-small font-semibold text-fg-muted">
                <Icon name="lock" size={16} strokeWidth={2} />
                {locked}
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className="mt-1.5 flex min-h-6 items-start justify-between gap-3">
        {error ? <p id={errId} className={`${errorCls} mt-0`}>{error}</p> : <span />}
        {!disabled && mode === 'draw' && value ? (
          <button type="button" onClick={clear} className="flex-none rounded-pill px-2 text-small font-semibold text-fg-muted underline-offset-2 hover:text-fg hover:underline">
            Clear
          </button>
        ) : null}
        {!disabled && mode === 'existing' ? (
          <button
            type="button"
            onClick={() => { setMode('draw'); setValue(''); setSignedAt(null); strokes.current = []; }}
            className="flex-none rounded-pill px-2 text-small font-semibold text-fg-muted underline-offset-2 hover:text-fg hover:underline"
          >
            Sign again
          </button>
        ) : null}
      </div>
      <input type="hidden" name={`sig.${name}`} value={value} />
    </div>
  );
}
