import Link from 'next/link';
import { Input, Label } from '@/components/ui/Field';
import { Logo } from '@/components/ui/Logo';
import { buttonClass } from '@/components/ui/styles';
import { signOut } from '@/app/(admin)/login/actions';
import { getMember } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { acceptMode } from '@/lib/users/rules';
import { acceptInvite, setPassword } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Password · Trailers & Tankers' };

const ERRORS: Record<string, string> = {
  short: 'Use at least 10 characters.',
  mismatch: 'The passwords do not match.',
  current: 'Your current password is not right.',
  auth: 'The password could not be saved. Try a different one.',
  access: 'Your account has no access to this organisation.',
};

/**
 * Outside the admin layout on purpose: invited members (no access yet) land here from /auth/confirm to set a
 * password, which accepts the invite. Active members use it to change their password.
 */
export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const member = await getMember();
  // Only an invite that created a brand-new account (link verified within the hour) sets a first password here;
  // an existing account accepts with its own current password. Own row, service role (RLS gives invitees nothing).
  let mode: 'new' | 'existing' | null = null;
  if (member?.status === 'invited') {
    const { data } = await createAdminClient().from('memberships').select('invite_new_account, invite_verified_at')
      .eq('org_id', member.orgId).eq('user_id', member.userId).maybeSingle();
    mode = acceptMode({ inviteNewAccount: data?.invite_new_account === true, inviteVerifiedAt: (data?.invite_verified_at as string | null) ?? null });
  }
  const invited = mode === 'new';
  const joining = mode === 'existing';
  const temporary = member?.status === 'active' && member.mustChangePassword === true;
  const blocked = !member || member.status === 'disabled';

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4 text-fg">
      <div className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-surface p-8 shadow-overlay">
        <div className="-mx-8 -mt-8 mb-2 flex items-center rounded-t-lg bg-side px-8 py-4">
          <Logo variant="on-dark" height={40} />
        </div>
        <h1 className="text-h1">{joining ? 'Accept the invitation' : invited ? 'Set your password' : temporary ? 'Choose a new password' : 'Change your password'}</h1>
        {blocked ? (
          <>
            <p role="alert" className="rounded-sm bg-status-red-bg p-3 text-body font-semibold text-status-red-fg">
              {member?.status === 'disabled' ? 'Your access has been disabled. Ask an admin.' : ERRORS.access}
            </p>
            <form action={signOut}><button className={buttonClass('secondary', 44, 'w-full')}>Sign out</button></form>
          </>
        ) : joining ? (
          <form action={acceptInvite} className="space-y-4">
            <p className="text-body text-fg-muted">You have been invited to this organisation. Your account already exists: confirm it is you with your current password. Your password does not change.</p>
            {error ? <p role="alert" className="rounded-sm bg-status-red-bg p-3 text-body font-semibold text-status-red-fg">{ERRORS[error] ?? ERRORS.auth}</p> : null}
            <div>
              <Label htmlFor="current">Current password</Label>
              <Input id="current" name="current" type="password" required autoComplete="current-password" />
            </div>
            <button className={buttonClass('primary', 52, 'w-full')}>Accept invitation</button>
          </form>
        ) : (
          <form action={setPassword} className="space-y-4">
            {invited ? <p className="text-body text-fg-muted">Welcome. Choose a password to finish setting up your account.</p> : null}
            {temporary ? <p className="text-body text-fg-muted">You signed in with a temporary password. Choose your own to continue.</p> : null}
            {error ? <p role="alert" className="rounded-sm bg-status-red-bg p-3 text-body font-semibold text-status-red-fg">{ERRORS[error] ?? ERRORS.auth}</p> : null}
            {!invited && !temporary ? (
              <div>
                <Label htmlFor="current">Current password</Label>
                <Input id="current" name="current" type="password" required autoComplete="current-password" />
              </div>
            ) : null}
            <div>
              <Label htmlFor="password">New password</Label>
              <Input id="password" name="password" type="password" required minLength={10} maxLength={200} autoComplete="new-password" aria-describedby="password-hint" />
              <p id="password-hint" className="mt-1 text-small text-fg-muted">At least 10 characters.</p>
            </div>
            <div>
              <Label htmlFor="confirm">Repeat new password</Label>
              <Input id="confirm" name="confirm" type="password" required minLength={10} maxLength={200} autoComplete="new-password" />
            </div>
            <button className={buttonClass('primary', 52, 'w-full')}>{invited || temporary ? 'Set password and continue' : 'Change password'}</button>
            {!invited && !temporary ? <Link href="/admin/account" className="block text-center underline">Back to my account</Link> : null}
          </form>
        )}
      </div>
    </main>
  );
}
