'use client';

import { useActionState } from 'react';
import { formatMoney } from '@/lib/admin/format';
import type { MonthLine } from '@/lib/integrations/xero/month';
import { checkMonth } from './actions';

export function MonthCheck({ defaultMonth }: { defaultMonth: string }) {
  const [state, action, pending] = useActionState(checkMonth, {} as { lines?: MonthLine[]; error?: string; month?: string });
  return (
    <div className="space-y-2">
      <form action={action} className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col">
          <span className="text-xs text-neutral-600">Month</span>
          <input type="month" name="month" defaultValue={state.month ?? defaultMonth} className="rounded border px-2 py-1" />
        </label>
        <button className="rounded border px-3 py-1" disabled={pending}>{pending ? 'Checking…' : 'Compare with Xero'}</button>
      </form>
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      {state.lines ? (
        <table className="w-full text-sm" data-testid="month-check">
          <thead className="text-left text-xs text-neutral-600">
            <tr><th>What</th><th>Currency</th><th className="text-right">Xero</th><th className="text-right">Mirror</th><th className="text-right">Xero total</th><th className="text-right">Mirror total</th><th>Result</th></tr>
          </thead>
          <tbody>
            {state.lines.map((l) => (
              <tr key={`${l.entity}-${l.currency}`} className="border-t">
                <td>{l.entity}</td><td>{l.currency}</td>
                <td className="text-right tabular-nums">{l.xeroCount}</td><td className="text-right tabular-nums">{l.mirrorCount}</td>
                <td className="text-right tabular-nums">{formatMoney(l.xeroTotal, l.currency)}</td><td className="text-right tabular-nums">{formatMoney(l.mirrorTotal, l.currency)}</td>
                <td className={l.match ? 'text-green-800' : 'text-red-800'}>{l.match ? 'Match' : 'Differs'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
