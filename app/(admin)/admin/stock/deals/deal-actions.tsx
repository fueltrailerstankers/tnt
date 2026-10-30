'use client';

import { useActionState, useEffect, useId, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { FieldError, Label, Textarea } from '@/components/ui/Field';
import { cardClass } from '@/components/ui/styles';
import { DEALS_COPY } from '@/lib/stock/deals-view';
import { dismissDeal, restoreDeal, type DealActionState } from './actions';

/** Dismiss (admin): a dialog with a required reason. The RPC re-checks the role and the deal's status. */
export function DismissButton({ dealId, year, number }: { dealId: string; year: number; number: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, submit, pending] = useActionState(dismissDeal, {} as DealActionState);
  const ids = useId();
  const title = DEALS_COPY.dismissTitle(year, number);

  useEffect(() => {
    if (state.ok) ref.current?.close();
  }, [state]);

  return (
    <>
      <Button variant="ghost" size={36} onClick={() => ref.current?.showModal()} aria-label={`${DEALS_COPY.dismiss} deal ${year} / ${number}`}>
        {DEALS_COPY.dismiss}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={`${ids}-t`}
        className={`${cardClass} m-auto w-[min(28rem,calc(100vw-2rem))] p-0 text-fg backdrop:bg-overlay`}
      >
        <form action={submit} className="space-y-4 p-5">
          <h2 id={`${ids}-t`} className="text-h2">{title}</h2>
          <input type="hidden" name="deal_id" value={dealId} />
          <div>
            <Label htmlFor={`${ids}-r`} required>{DEALS_COPY.reasonLabel}</Label>
            <Textarea
              id={`${ids}-r`}
              name="reason"
              required
              maxLength={200}
              rows={3}
              aria-describedby={`${ids}-h${state.error ? ` ${ids}-e` : ''}`}
              aria-invalid={state.error ? true : undefined}
            />
            <p id={`${ids}-h`} className="mt-1 text-small text-fg-muted">{DEALS_COPY.reasonHint}</p>
            {state.error ? <FieldError id={`${ids}-e`}>{state.error}</FieldError> : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => ref.current?.close()}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={pending}>{pending ? 'Dismissing…' : DEALS_COPY.dismiss}</Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** Restore (admin): puts a dismissed deal back on the list. */
export function RestoreButton({ dealId, year, number }: { dealId: string; year: number; number: number }) {
  const [state, submit, pending] = useActionState(restoreDeal, {} as DealActionState);
  return (
    <form action={submit} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="deal_id" value={dealId} />
      <Button type="submit" variant="secondary" disabled={pending} aria-label={`${DEALS_COPY.restore} deal ${year} / ${number}`}>
        {pending ? 'Restoring…' : DEALS_COPY.restore}
      </Button>
      {state.error ? <span role="alert" className="text-small text-status-red-fg">{state.error}</span> : null}
    </form>
  );
}
