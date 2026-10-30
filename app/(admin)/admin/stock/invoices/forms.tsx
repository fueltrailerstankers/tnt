'use client';

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/Field';
import { applyManualInvoice, resolveException, type InvoiceActionState } from './actions';

/** Submits without React's automatic form reset, so typed values survive an error; clears them after success. */
function useKeepValues(dispatch: (fd: FormData) => void, state: InvoiceActionState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok, state.at]);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
  return { ref, onSubmit };
}

/** Plan 7.5 "Manual invoice update" (was "Simulate an invoice update"). */
export function ManualInvoiceForm() {
  const [state, dispatch, pending] = useActionState(applyManualInvoice, {} as InvoiceActionState);
  const { ref, onSubmit } = useKeepValues(dispatch, state);
  return (
    <form ref={ref} onSubmit={onSubmit} className="space-y-3" data-testid="manual-invoice-form" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="mi-invoice" required>Invoice number</Label>
          <Input id="mi-invoice" name="invoice_number" placeholder="INV-0042" autoComplete="off" maxLength={50} required />
        </div>
        <div>
          <Label htmlFor="mi-reference" required>Invoice reference (VIN)</Label>
          <Input id="mi-reference" name="reference" placeholder="Enter the full VIN" autoComplete="off" maxLength={500} required />
        </div>
      </div>
      <div>
        <Label htmlFor="mi-status" required>Payment status</Label>
        <Select id="mi-status" name="status" defaultValue="reserved">
          <option value="reserved">Unpaid / partly paid — Reserved</option>
          <option value="sold">Fully paid — Sold</option>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? 'Applying…' : 'Apply update'}</Button>
        {state.error ? <FieldError>{state.error}</FieldError> : null}
        {state.ok ? <p role="status" className="text-body font-semibold text-status-green-fg">{state.ok}</p> : null}
      </div>
    </form>
  );
}

/** Resolve one exception: a required note, kept on the exception. */
export function ResolveExceptionForm({ id }: { id: string }) {
  const [state, dispatch, pending] = useActionState(resolveException, {} as InvoiceActionState);
  const { ref, onSubmit } = useKeepValues(dispatch, state);
  if (state.ok) return <p role="status" className="text-small font-semibold text-status-green-fg">{state.ok}</p>;
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-small font-semibold text-accent-text underline">Resolve</summary>
      <form ref={ref} onSubmit={onSubmit} className="mt-2 space-y-2" noValidate>
        <input type="hidden" name="id" value={id} />
        <Label htmlFor={`note-${id}`} required>Resolution note</Label>
        <Textarea id={`note-${id}`} name="note" rows={2} maxLength={500} placeholder="What was done, e.g. credit note agreed with the branch" />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size={36} variant="secondary" disabled={pending}>{pending ? 'Saving…' : 'Mark resolved'}</Button>
          {state.error ? <FieldError>{state.error}</FieldError> : null}
        </div>
      </form>
    </details>
  );
}
