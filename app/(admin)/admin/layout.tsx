import { signOut } from '../login/actions';
import { can } from '@/lib/security/can';
import { getMember } from '@/lib/security/require';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const member = await getMember();
  if (!can(member, 'admin.access')) {
    // Signed in (middleware guarantees it) but without a membership or the permission.
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-sm space-y-3 text-center">
          <h1 className="text-lg font-semibold">No access</h1>
          <p className="text-sm text-neutral-600">Your account has no access to this organisation.</p>
          <form action={signOut}>
            <button className="rounded border px-3 py-2 text-sm">Sign out</button>
          </form>
        </div>
      </main>
    );
  }
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="flex items-center justify-between border-b bg-white px-4 py-3">
        <span className="font-semibold">Trailers &amp; Tankers · Admin</span>
        <form action={signOut}>
          <button className="rounded border px-3 py-1 text-sm">Sign out</button>
        </form>
      </header>
      <div className="mx-auto max-w-5xl p-4">{children}</div>
    </div>
  );
}
