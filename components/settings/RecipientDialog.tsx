'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { saveRecipient, type RecipientState } from '@/app/(admin)/admin/settings/notifications/actions';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { inputClass, labelClass } from '@/components/ui/styles';

export interface RecipientDraft { id: string | null; eventKey: string; address: string; branch: string | null; active: boolean }

const BLANK: RecipientDraft = { id: null, eventKey: '', address: '', branch: null, active: true };

/** Add recipient / Edit: a button that opens the form in a Modal. */
export function RecipientDialog({ recipient, eventKeys, label }: { recipient?: RecipientDraft; eventKeys: string[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const editing = !!recipient;
  return (
    <>
      {editing
        ? <Button variant="secondary" size={30} onClick={() => setOpen(true)} aria-label={label}>Edit</Button>
        : <Button size={36} onClick={() => setOpen(true)}>Add recipient</Button>}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit recipient' : 'Add recipient'} description="Who gets emailed for an event. Branch blank means all branches." size="lg">
        <RecipientForm recipient={recipient ?? BLANK} eventKeys={eventKeys} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function RecipientForm({ recipient, eventKeys, onDone }: { recipient: RecipientDraft; eventKeys: string[]; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveRecipient, {} as RecipientState);
  const listId = useId();
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => { if (state.ok) done.current(); }, [state]);
  const e = state.errors ?? {};
  const inv = (k: 'eventKey' | 'address' | 'branch') => (e[k] ? { 'aria-invalid': true as const, 'aria-describedby': `rcpt-${k}-err` } : {});

  return (
    <form action={action} className="flex flex-col gap-3.5" noValidate>
      {recipient.id ? <input type="hidden" name="id" value={recipient.id} /> : null}
      {e.form ? <p role="alert" className="m-0 rounded-sm bg-status-red-bg px-3 py-2 text-small text-status-red-fg">{e.form}</p> : null}
      <div className="flex flex-col">
        <label htmlFor="rcpt-event" className={labelClass}>Event key</label>
        <input id="rcpt-event" name="eventKey" defaultValue={recipient.eventKey} list={listId} required autoComplete="off" spellCheck={false} placeholder="release.paid" className={`${inputClass} font-mono`} {...inv('eventKey')} />
        <datalist id={listId}>{eventKeys.map((k) => <option key={k} value={k} />)}</datalist>
        {e.eventKey ? <p id="rcpt-eventKey-err" className="m-0 mt-1 text-small text-status-red-fg">{e.eventKey}</p> : null}
      </div>
      <div className="flex flex-col">
        <label htmlFor="rcpt-address" className={labelClass}>Address</label>
        <input id="rcpt-address" name="address" type="email" defaultValue={recipient.address} required autoComplete="off" placeholder="accounts@example.com" className={inputClass} {...inv('address')} />
        {e.address ? <p id="rcpt-address-err" className="m-0 mt-1 text-small text-status-red-fg">{e.address}</p> : null}
      </div>
      <div className="flex flex-col">
        <label htmlFor="rcpt-branch" className={labelClass}>Branch (optional)</label>
        <input id="rcpt-branch" name="branch" defaultValue={recipient.branch ?? ''} maxLength={60} placeholder="All branches" className={inputClass} {...inv('branch')} />
        {e.branch ? <p id="rcpt-branch-err" className="m-0 mt-1 text-small text-status-red-fg">{e.branch}</p> : null}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-body">
        <input type="checkbox" name="active" defaultChecked={recipient.active} className="size-4 accent-accent" />
        Active (gets emails)
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size={38} onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" size={38} loading={pending}>{recipient.id ? 'Save recipient' : 'Add recipient'}</Button>
      </div>
    </form>
  );
}
