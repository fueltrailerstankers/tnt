'use client';

import { useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { checkViewName, VIEW_NAME_MAX } from '@/lib/ui/views';
import { Button } from './Button';
import { Modal } from './Modal';
import { buttonClass } from './styles';

export interface SavedView {
  id: string;
  label: string;
  /** Built-in views ("All entries", "Unread") cannot be deleted. */
  builtIn?: boolean;
}

export interface SavedViewsMenuProps {
  views: readonly SavedView[];
  value: string;
  onSelect: (id: string) => void;
  /** Shows "Save view"; called with a checked name. Persisting it is the caller's job (server action, RLS). */
  onSave?: (name: string) => void | Promise<void>;
  /** Shows "Delete view" for the current user view. */
  onDelete?: (id: string) => void | Promise<void>;
  label?: string;
}

/** View picker for list toolbars: a select of built-in and saved views, plus Save view / Delete view. UI only. */
export function SavedViewsMenu({ views, value, onSelect, onSave, onDelete, label = 'View' }: SavedViewsMenuProps) {
  const selectId = useId();
  const builtIn = views.filter((v) => v.builtIn);
  const saved = views.filter((v) => !v.builtIn);
  const current = views.find((v) => v.id === value);
  const [saving, setSaving] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={selectId} className="text-small text-fg-muted">{label}</label>
      <select
        id={selectId}
        value={value}
        onChange={(e) => onSelect(e.target.value)}
        className="h-8 rounded-sm border border-border-strong bg-surface px-2 text-base font-semibold text-fg sm:text-small"
      >
        {builtIn.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        {saved.length ? (
          <optgroup label="Saved views">
            {saved.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </optgroup>
        ) : null}
      </select>
      {onSave ? <button type="button" onClick={() => setSaving(true)} className={buttonClass('link')}>Save view</button> : null}
      {onDelete && current && !current.builtIn ? (
        <button type="button" onClick={() => onDelete(current.id)} className="rounded-pill border-0 bg-transparent p-1 text-small font-semibold text-status-red-fg hover:underline">Delete view</button>
      ) : null}
      {onSave ? <SaveViewModal open={saving} onClose={() => setSaving(false)} views={views} onSave={onSave} /> : null}
    </div>
  );
}

function SaveViewModal({ open, onClose, views, onSave }: { open: boolean; onClose: () => void; views: readonly SavedView[]; onSave: (name: string) => void | Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Save view" description="Saves the current filters, search and columns." size="sm" pending={pending} initialFocus={input}>
      <SaveViewForm inputRef={input} views={views} onSave={onSave} onClose={onClose} pending={pending} setPending={setPending} />
    </Modal>
  );
}

function SaveViewForm({
  inputRef, views, onSave, onClose, pending, setPending,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  views: readonly SavedView[];
  onSave: (name: string) => void | Promise<void>;
  onClose: () => void;
  pending: boolean;
  setPending: (p: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const check = checkViewName(name, views);
    if (!check.ok) { setError(check.message); return; }
    setPending(true);
    let done = false;
    try {
      await onSave(check.name);
      done = true;
    } catch {
      setError('Could not save the view. Try again.');
    } finally {
      setPending(false);
    }
    if (done) onClose();
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-small font-semibold">View name</label>
        <input
          ref={inputRef}
          id={inputId}
          value={name}
          maxLength={VIEW_NAME_MAX}
          onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="h-[38px] w-full rounded-sm border border-border-strong bg-surface px-3 text-base text-fg outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft aria-[invalid=true]:border-2 aria-[invalid=true]:border-danger sm:text-body"
        />
        {error ? <p id={errorId} className="m-0 text-small text-status-red-fg">{error}</p> : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size={38} onClick={onClose} disabled={pending}>Cancel</Button>
        <Button type="submit" size={38} loading={pending}>Save view</Button>
      </div>
    </form>
  );
}
