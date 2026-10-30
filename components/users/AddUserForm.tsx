'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { addUser } from '@/app/(admin)/admin/settings/users/actions';
import { Input, Label, Select } from '@/components/ui/Field';
import { buttonClass, cardClass } from '@/components/ui/styles';
import { PRESET_ACCESS } from '@/lib/security/can';
import { TEMP_PASSWORD_MIN, USER_ERRORS, type AddState } from '@/lib/users/rules';
import { AccessMatrix } from './AccessMatrix';
import { CopyText } from './CopyText';

/** Add user: an account with a temporary password, active at once; they choose their own password on first sign-in. */
export function AddUserForm({ branches, allowAdmin }: { branches: Array<{ id: string; name: string }>; allowAdmin: boolean }) {
  const [state, action, pending] = useActionState(addUser, { status: 'idle' } as AddState);
  const [generate, setGenerate] = useState(true);

  if (state.status === 'done' && state.userId) {
    return (
      <div className={`${cardClass} space-y-3 p-4`} role="status">
        <h2 className="text-h2">User added</h2>
        {state.password ? (
          <>
            <p>Give them this temporary password. It is shown only now; they must change it when they first sign in.</p>
            <CopyText value={state.password} label="Temporary password" />
          </>
        ) : <p>Give them the temporary password you chose. They must change it when they first sign in.</p>}
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/settings/users/${state.userId}`} className={buttonClass('primary', 44)}>Open user</Link>
          <Link href="/admin/settings/users" className={buttonClass('secondary', 44)}>Back to users</Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className={`${cardClass} space-y-4 p-4`}>
      {state.status === 'error' ? <p role="alert" className="rounded-sm bg-status-red-bg p-3 text-status-red-fg">{USER_ERRORS[state.error ?? 'input'] ?? USER_ERRORS.input}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="name" required>Name</Label>
          <Input id="name" name="name" required maxLength={120} autoComplete="off" />
        </div>
        <div>
          <Label htmlFor="email" required>Email</Label>
          <Input id="email" name="email" type="email" required maxLength={254} autoComplete="off" />
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-small font-semibold">Temporary password</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="generate" checked={generate} onChange={(e) => setGenerate(e.target.checked)} className="size-5" />
          Generate one for me (shown once)
        </label>
        {!generate ? (
          <div>
            <Label htmlFor="password" required>Temporary password</Label>
            <Input id="password" name="password" type="text" required minLength={TEMP_PASSWORD_MIN} maxLength={200} autoComplete="off" aria-describedby="password-hint" />
            <p id="password-hint" className="mt-1 text-small text-fg-muted">At least {TEMP_PASSWORD_MIN} characters.</p>
          </div>
        ) : null}
      </fieldset>
      <AccessMatrix initialRole="staff" initialAccess={PRESET_ACCESS.staff} allowAdmin={allowAdmin} />
      {branches.length ? (
        <div>
          <Label htmlFor="branch">Branch (optional)</Label>
          <Select id="branch" name="branch" defaultValue="" className="max-w-xs">
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
      ) : null}
      <button disabled={pending} className={buttonClass('primary', 44)}>Add user</button>
      <p className="text-small text-fg-muted">The account is active straight away. No email is sent; they must choose their own password when they first sign in.</p>
    </form>
  );
}
