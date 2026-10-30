'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { inviteUser } from '@/app/(admin)/admin/settings/users/actions';
import { Input, Label, Select } from '@/components/ui/Field';
import { buttonClass, cardClass } from '@/components/ui/styles';
import { PRESET_ACCESS } from '@/lib/security/can';
import { USER_ERRORS, type InviteState } from '@/lib/users/rules';
import { AccessMatrix } from './AccessMatrix';
import { CopyText } from './CopyText';

const SENT: Record<NonNullable<InviteState['sent']>, string> = {
  email: 'Invite email sent. The person sets a password from the email, then signs in.',
  email_failed: 'The invite email could not be sent. Send this link to the person instead:',
  existing: 'This person already has an account, so no invite email was sent. Send this sign-in link instead:',
  link: 'Invite created. Send this link to the person; it opens the set-password page:',
};

export function InviteForm({ branches, allowAdmin }: { branches: Array<{ id: string; name: string }>; allowAdmin: boolean }) {
  const [state, action, pending] = useActionState(inviteUser, { status: 'idle' } as InviteState);

  if (state.status === 'done' && state.userId) {
    return (
      <div className={`${cardClass} space-y-3 p-4`} role="status">
        <h2 className="text-h2">Invited</h2>
        <p>{SENT[state.sent ?? 'link']}</p>
        {state.link ? <CopyText value={state.link} label="Invite link" /> : null}
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
          <Input id="name" name="name" key={`n-${state.values?.name}`} defaultValue={state.values?.name} required maxLength={120} autoComplete="off" />
        </div>
        <div>
          <Label htmlFor="email" required>Email</Label>
          <Input id="email" name="email" key={`e-${state.values?.email}`} defaultValue={state.values?.email} type="email" required maxLength={254} autoComplete="off" />
        </div>
      </div>
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
      <div className="flex flex-wrap gap-2">
        <button name="method" value="email" disabled={pending} className={buttonClass('primary', 44)}>Send invite email</button>
        <button name="method" value="link" disabled={pending} className={buttonClass('secondary', 44)}>Create invite link</button>
      </div>
      <p className="text-small text-fg-muted">Use Create invite link when email delivery is not set up: you copy the link and send it yourself.</p>
    </form>
  );
}
