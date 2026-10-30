'use client';

import { useId, useState, useTransition } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';

export type RevealResult = { ok: true; value: string } | { ok: false; message: string };

export interface ProtectedFieldProps {
  label: string;
  /** Masked on the SERVER (lib/ui/mask.ts). The clear value is never a prop of this component. */
  masked: string;
  /**
   * Admins only: a server action that checks the permission, writes the audit row (keys only, never the value)
   * and returns the clear value. Leave it out for everyone else; they see the mask and no button.
   */
  reveal?: () => Promise<RevealResult>;
  hint?: string;
  id?: string;
}

const BOX = 'h-[38px] w-full rounded-sm bg-surface-2 px-3 font-mono text-body outline-none';

/** Masked value with a lock; admins can Reveal (audited by the action) and Hide again. */
export function ProtectedField({ label, masked, reveal, hint = 'protected · masked for non-admins', id }: ProtectedFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const noteId = `${inputId}-note`;
  const [clear, setClear] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onReveal = () => {
    if (!reveal) return;
    setError(null);
    start(async () => {
      try {
        const r = await reveal();
        if (r.ok) setClear(r.value);
        else setError(r.message || 'Could not reveal the value.');
      } catch {
        setError('Could not reveal the value.');
      }
    });
  };

  const shown = clear !== null;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="flex flex-wrap items-center gap-1.5 text-small font-semibold text-fg">
        {label}
        <span role="img" aria-label="Protected field" className="inline-flex text-fg-muted">
          <Icon name="lock" size={13} strokeWidth={2} />
        </span>
        {hint ? <span className="font-normal text-fg-muted">{hint}</span> : null}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          readOnly
          value={shown ? clear : masked}
          aria-describedby={noteId}
          className={shown ? `${BOX} border border-transparent text-fg` : `${BOX} border border-dashed border-border-strong tracking-[1px] text-fg-muted`}
        />
        {reveal ? (
          shown ? (
            <Button variant="secondary" size={32} onClick={() => setClear(null)}>
              <Icon name="lock" size={14} strokeWidth={2} />
              Hide
            </Button>
          ) : (
            <Button variant="secondary" size={32} onClick={onReveal} loading={pending}>
              {pending ? null : <Icon name="eye" size={14} strokeWidth={2} />}
              Reveal
            </Button>
          )
        ) : null}
      </div>
      <span id={noteId} className="sr-only">{shown ? 'Value revealed. Revealing is logged.' : 'Value hidden.'}</span>
      {error ? (
        <p role="alert" className="m-0 flex items-center gap-1.5 text-small text-status-red-fg">
          <Icon name="warning" size={14} strokeWidth={2} />
          {error}
        </p>
      ) : null}
    </div>
  );
}
