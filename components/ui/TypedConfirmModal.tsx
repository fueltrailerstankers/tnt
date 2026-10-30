'use client';

import { useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { typedMatches } from '@/lib/ui/confirm';
import { Button } from './Button';
import { Icon } from './Icon';
import { Modal } from './Modal';

export interface TypedConfirmResult {
  ok: boolean;
  /** Shown under the input when ok is false. No personal data. */
  message?: string;
}

export interface TypedConfirmModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  body?: ReactNode;
  /** Exact text to type, shown in a mono chip. For Xero write actions use livePhrase(action) from lib/ui/confirm. */
  phrase: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'destructive' | 'primary';
  /**
   * Runs only after an exact match. Usually a server action, which must re-check with typedMatches() and the
   * permission itself. Return { ok: false, message } to keep the modal open with an error; anything else closes it.
   */
  onConfirm: (typed: string) => Promise<TypedConfirmResult | void> | TypedConfirmResult | void;
}

/** Confirmation that needs the user to type a phrase. The confirm button stays disabled until the text matches exactly. */
export function TypedConfirmModal({ open, onClose, title, body, phrase, confirmLabel = 'Go live', cancelLabel = 'Cancel', tone = 'destructive', onConfirm }: TypedConfirmModalProps) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={title} description={body} size="md" pending={pending} initialFocus={input} role="alertdialog">
      {/* Mounted only while open, so the typed text and error reset each time. */}
      <TypedConfirmForm
        inputRef={input}
        phrase={phrase}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        tone={tone}
        onConfirm={onConfirm}
        onClose={onClose}
        pending={pending}
        setPending={setPending}
      />
    </Modal>
  );
}

function TypedConfirmForm({
  inputRef, phrase, confirmLabel, cancelLabel, tone, onConfirm, onClose, pending, setPending,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  phrase: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: 'destructive' | 'primary';
  onConfirm: TypedConfirmModalProps['onConfirm'];
  onClose: () => void;
  pending: boolean;
  setPending: (p: boolean) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();
  const matches = typedMatches(value, phrase);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!matches || pending) return;
    setPending(true);
    setError(null);
    let close = false;
    try {
      const result = await onConfirm(value);
      if (result && result.ok === false) setError(result.message || 'Could not confirm. Try again.');
      else close = true;
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setPending(false);
    }
    if (close) onClose();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-small font-semibold">
          Type <code className="rounded-xs bg-surface-2 px-[5px] py-px font-mono">{phrase}</code> to confirm
        </label>
        <input
          ref={inputRef}
          id={inputId}
          value={value}
          onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          readOnly={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="h-10 w-full rounded-sm border border-border-strong bg-surface px-3 font-mono text-base text-fg outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft aria-[invalid=true]:border-2 aria-[invalid=true]:border-danger sm:text-small"
        />
        {error ? (
          <p id={errorId} role="alert" className="flex items-center gap-1.5 text-small text-status-red-fg">
            <Icon name="warning" size={14} strokeWidth={2} />
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size={38} onClick={onClose} disabled={pending}>{cancelLabel}</Button>
        <Button type="submit" variant={tone} size={38} disabled={!matches} loading={pending}>{confirmLabel}</Button>
      </div>
    </form>
  );
}
