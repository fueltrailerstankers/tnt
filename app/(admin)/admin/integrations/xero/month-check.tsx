'use client';

import { useActionState, useId } from 'react';
import { Button } from '@/components/ui/Button';
import { StatusChip } from '@/components/ui/StatusChip';
import { inputClass, labelClass, tableClass, tableWrapClass, theadClass } from '@/components/ui/styles';
import { formatMoney } from '@/lib/admin/format';
import type { MonthLine } from '@/lib/integrations/xero/month';
import { checkMonth } from './actions';

export function MonthCheck({ defaultMonth }: { defaultMonth: string }) {
  const [state, action, pending] = useActionState(checkMonth, {} as { lines?: MonthLine[]; error?: string; month?: string });
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col">
          <label htmlFor={id} className={labelClass}>Month</label>
          <input id={id} type="month" name="month" defaultValue={state.month ?? defaultMonth} className={`${inputClass} h-[38px] w-48 py-0`} />
        </div>
        <Button type="submit" variant="secondary" size={38} loading={pending}>{pending ? 'Checking…' : 'Compare with Xero'}</Button>
      </form>
      {state.error ? <p role="alert" className="m-0 text-small text-status-red-fg">{state.error}</p> : null}
      {state.lines ? (
        <div className={`relative ${tableWrapClass}`} role="region" aria-label="Xero and mirror comparison" tabIndex={0}>
          <table className={`${tableClass} min-w-[640px] text-small`} data-testid="month-check">
            <thead className={theadClass}>
              <tr><th className="p-2">What</th><th className="p-2">Currency</th><th className="p-2 text-right">Xero</th><th className="p-2 text-right">Mirror</th><th className="p-2 text-right">Xero total</th><th className="p-2 text-right">Mirror total</th><th className="p-2">Result</th></tr>
            </thead>
            <tbody>
              {state.lines.map((l) => (
                <tr key={`${l.entity}-${l.currency}`} className="border-t border-border">
                  <td className="p-2">{l.entity}</td><td className="p-2 font-mono">{l.currency}</td>
                  <td className="p-2 text-right tabular-nums">{l.xeroCount}</td><td className="p-2 text-right tabular-nums">{l.mirrorCount}</td>
                  <td className="p-2 text-right font-mono tabular-nums">{formatMoney(l.xeroTotal, l.currency)}</td><td className="p-2 text-right font-mono tabular-nums">{formatMoney(l.mirrorTotal, l.currency)}</td>
                  <td className="p-2"><StatusChip status={l.match ? 'Match' : 'Differs'} color={l.match ? 'green' : 'red'} size="sm" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
