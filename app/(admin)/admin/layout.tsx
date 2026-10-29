import { signOut } from '../login/actions';
import { AppShell } from '@/components/shell/AppShell';
import { buttonClass } from '@/components/ui/styles';
import { can } from '@/lib/security/can';
import { getMember } from '@/lib/security/require';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const member = await getMember();
  if (!member || !can(member, 'admin.access')) {
    // Signed in (middleware guarantees it) but without a membership or the permission.
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg p-4">
        <div className="max-w-sm space-y-3 text-center">
          <h1 className="text-h2">No access</h1>
          <p className="text-body text-fg-muted">Your account has no access to this organisation.</p>
          <form action={signOut}>
            <button className={buttonClass('secondary', 44)}>Sign out</button>
          </form>
        </div>
      </main>
    );
  }
  return <AppShell member={member} signOut={signOut}>{children}</AppShell>;
}
