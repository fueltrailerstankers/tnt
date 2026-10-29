'use client';

import { useActionState, useState } from 'react';
import { planMergeFor, setActionMode, type SwitchState } from './server-actions';

export function ModeSwitch({ action, current, canLive }: { action: string; current: string; canLive: boolean }) {
  const [state, submit, pending] = useActionState(setActionMode, {} as SwitchState);
  const [mode, setMode] = useState(current);
  return (
    <form action={submit} className="flex flex-wrap items-end gap-2 text-sm" data-testid={`mode-${action}`}>
      <input type="hidden" name="action" value={action} />
      <label className="flex flex-col">
        <span className="text-xs text-neutral-600">Mode</span>
        <select name="mode" value={mode} onChange={(e) => setMode(e.target.value)} className="rounded border px-2 py-1">
          <option value="off">off</option>
          <option value="dry_run">dry run</option>
          <option value="live" disabled={!canLive}>live</option>
        </select>
      </label>
      {mode === 'live' ? (
        <label className="flex flex-col">
          <span className="text-xs text-neutral-600">Type <code>{action}</code> to confirm</span>
          <input name="confirm" autoComplete="off" className="rounded border px-2 py-1" />
        </label>
      ) : null}
      <button className="rounded border px-3 py-1" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
      {state.error ? <span className="text-red-700">{state.error}</span> : null}
      {state.ok ? <span className="text-green-800">{state.ok}</span> : null}
    </form>
  );
}

export function MergePlanForm() {
  const [state, submit, pending] = useActionState(planMergeFor, {} as SwitchState);
  return (
    <form action={submit} className="flex flex-wrap items-end gap-2 text-sm">
      <label className="flex flex-col">
        <span className="text-xs text-neutral-600">Invoice no</span>
        <input name="invoice" placeholder="INV-…" className="rounded border px-2 py-1" />
      </label>
      <button className="rounded border px-3 py-1" disabled={pending}>Plan merge</button>
      {state.error ? <span className="text-red-700">{state.error}</span> : null}
      {state.ok ? <span className="text-green-800">{state.ok}</span> : null}
    </form>
  );
}
