'use client';

import { useActionState, useId } from 'react';
import { Button } from '@/components/ui/Button';
import { inputClass, labelClass } from '@/components/ui/styles';
import { planMergeFor, type SwitchState } from './server-actions';

export function MergePlanForm() {
  const [state, submit, pending] = useActionState(planMergeFor, {} as SwitchState);
  const id = useId();
  return (
    <form action={submit} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col">
        <label htmlFor={id} className={labelClass}>Invoice no</label>
        <input id={id} name="invoice" placeholder="INV-…" className={`${inputClass} h-[38px] w-48 py-0`} />
      </div>
      <Button type="submit" variant="secondary" size={38} loading={pending}>Plan merge</Button>
      <p aria-live="polite" className={`m-0 text-small ${state.error ? 'text-status-red-fg' : 'text-status-green-fg'}`}>{state.error ?? state.ok ?? ''}</p>
    </form>
  );
}
