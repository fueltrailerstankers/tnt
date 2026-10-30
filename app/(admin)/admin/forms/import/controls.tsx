'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useId } from 'react';
import { buttonClass, inputClass, labelClass } from '@/components/ui/styles';
import { removeKeyAction, resumeRunAction, saveKeyAction, startRunAction, stopRunAction, testConnectionAction } from './actions';
import type { ActionState, ConnectionView } from './types';

function Message({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="text-small text-status-red-fg">{state.error}</p>;
  if (state.ok) return <p role="status" className="text-small text-status-green-fg">{state.ok}</p>;
  return null;
}

/** Save or replace the key. The field is a password field and is cleared after saving; the key is never sent back. */
export function KeyForm({ hasKey }: { hasKey: boolean }) {
  const [state, action, pending] = useActionState(saveKeyAction, {});
  const id = useId();
  return (
    <form action={action} className="space-y-2" data-testid="cognito-key-form">
      <label htmlFor={id} className={labelClass}>{hasKey ? 'Replace the API key' : 'Cognito API key'}</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={id} name="key" type="password" autoComplete="off" spellCheck={false} required minLength={8}
          className={inputClass} placeholder="Paste the key from Cognito: Organization settings, Integrations, API"
          key={state.ok ? 'saved' : 'editing'}
        />
        <button type="submit" className={buttonClass('primary', 44)} disabled={pending}>{pending ? 'Saving…' : hasKey ? 'Replace key' : 'Save key'}</button>
      </div>
      <Message state={state} />
    </form>
  );
}

export function RemoveKey() {
  const [state, action, pending] = useActionState(removeKeyAction, {});
  return (
    <form action={action} className="space-y-1">
      <button type="submit" className={buttonClass('destructive', 36)} disabled={pending}>{pending ? 'Removing…' : 'Remove key'}</button>
      <Message state={state} />
    </form>
  );
}

const fmt = (n: number | null) => (n === null ? '-' : n.toLocaleString('en-ZA'));

export function TestConnection() {
  const [state, action, pending] = useActionState(testConnectionAction, null as ConnectionView | null);
  return (
    <div className="space-y-3">
      <form action={action}>
        <button type="submit" className={buttonClass('secondary', 36)} disabled={pending}>{pending ? 'Testing…' : 'Test connection'}</button>
      </form>
      {state && !state.ok ? <p role="alert" className="text-small text-status-red-fg" data-testid="connection-error">{state.error}</p> : null}
      {state?.ok ? (
        <div className="space-y-2" data-testid="connection-result">
          <p role="status" className="text-small text-status-green-fg">
            Connected. Cognito lists {state.forms.length} {state.forms.length === 1 ? 'form' : 'forms'}.
            {state.entryAccess === 'denied' ? null : state.entryAccess === 'ok' ? ' The key can read entries.' : ''}
          </p>
          {state.entryAccess === 'denied' ? (
            <p role="alert" className="text-small text-status-red-fg">The key can list forms but not read entries. Give it read access to entries and files in Cognito.</p>
          ) : null}
          <ul className="divide-y divide-border rounded-md border border-border">
            {state.forms.map((f, i) => (
              <li key={`${f.cognitoId ?? 'x'}-${i}`} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="cognito-form">
                <div className="min-w-0">
                  <p className="font-semibold text-fg">{f.name}</p>
                  <p className="text-small text-fg-muted">
                    Cognito form {f.cognitoId ?? '?'} · entries: {f.entries !== null ? <span className="font-mono">{fmt(f.entries)}</span> : 'not reported (the dry run counts them)'}
                    {f.platform?.expected ? <> · at export about <span className="font-mono">{fmt(f.platform.expected)}</span></> : null}
                  </p>
                </div>
                <p className="text-small sm:max-w-[50%] sm:text-right">
                  {f.platform ? (
                    <>Imports into <Link href={`/admin/forms/${f.platform.slug}`} className="font-semibold">{f.platform.name}</Link></>
                  ) : (
                    <span className="text-fg-muted">Not in the platform yet — form definition import is not supported</span>
                  )}
                </p>
              </li>
            ))}
            {!state.forms.length ? <li className="p-3 text-small text-fg-muted">Cognito returned no forms for this key.</li> : null}
          </ul>
          {state.missing.length ? (
            <p className="text-small text-fg-muted">
              Not found in Cognito (archived, or the key cannot see them): {state.missing.map((m) => m.name).join(', ')}.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Dry run / Import for one form or "all", with an optional limit. */
export function RunForm({ form, disabled, label }: { form: string; disabled: boolean; label: string }) {
  const [state, action, pending] = useActionState(startRunAction, {});
  const id = useId();
  return (
    <form action={action} className="space-y-2" data-testid={`run-form-${form}`}>
      <input type="hidden" name="form" value={form} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-36">
          <label htmlFor={id} className="mb-1 block text-label text-fg-muted">At most (optional)</label>
          <input id={id} name="limit" inputMode="numeric" pattern="[0-9]*" placeholder="all entries" className={inputClass} aria-label={`Limit for ${label}`} />
        </div>
        <button type="submit" name="mode" value="dry_run" className={buttonClass('secondary', 44)} disabled={disabled || pending}>Dry run</button>
        <button type="submit" name="mode" value="apply" className={buttonClass('primary', 44)} disabled={disabled || pending}>Import</button>
      </div>
      <Message state={state} />
    </form>
  );
}

export function RunButton({ run, kind }: { run: string; kind: 'stop' | 'resume' }) {
  const [state, action, pending] = useActionState(kind === 'stop' ? stopRunAction : resumeRunAction, {});
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="run" value={run} />
      <button type="submit" className={buttonClass(kind === 'stop' ? 'secondary' : 'primary', 36)} disabled={pending}>{kind === 'stop' ? 'Stop' : 'Resume'}</button>
      <Message state={state} />
    </form>
  );
}

/** Refreshes the page every few seconds while a run is queued or running. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [active, router]);
  return active ? <p className="text-small text-fg-muted" role="status">Updating every few seconds while an import runs.</p> : null;
}
