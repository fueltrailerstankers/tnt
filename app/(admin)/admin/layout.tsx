import { redirect } from 'next/navigation';
import { signOut } from '../login/actions';
import { AppShell } from '@/components/shell/AppShell';
import { buttonClass } from '@/components/ui/styles';
import { can } from '@/lib/security/can';
import { getMember } from '@/lib/security/require';
import { ACCEPT_PATH } from '@/lib/users/rules';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const member = await getMember();
  // Signed in from an invite link but no password yet, or still on a temporary password (Add user): set one first
  // (that page is outside this layout).
  if (member?.status === 'invited' || (member?.status === 'active' && member.mustChangePassword)) redirect(ACCEPT_PATH);
  if (!member || !can(member, 'admin.access')) {
    // Signed in (middleware guarantees it) but without a membership, disabled, or with no area at all.
    const message = member?.status === 'disabled'
      ? 'Your access to this organisation has been disabled. Ask an admin.'
      : 'Your account has no access to this organisation.';
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg p-4">
        <div className="max-w-sm space-y-3 text-center">
          <h1 className="text-h2">No access</h1>
          <p className="text-body text-fg-muted">{message}</p>
          <form action={signOut}>
            <button className={buttonClass('secondary', 44)}>Sign out</button>
          </form>
        </div>
      </main>
    );
  }
  return <AppShell member={member} signOut={signOut}>{children}</AppShell>;
}
