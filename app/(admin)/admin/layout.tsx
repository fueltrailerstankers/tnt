import Link from 'next/link';
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
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <nav aria-label="Main" className="flex flex-wrap items-center gap-4 text-sm">
            <Link href="/admin" className="font-semibold">Trailers &amp; Tankers · Admin</Link>
            <Link href="/admin" className="hover:underline">Home</Link>
            {can(member, 'tasks.read') ? <Link href="/admin/tasks" className="hover:underline">Tasks</Link> : null}
            {can(member, 'settings.manage') ? <Link href="/admin/settings" className="hover:underline">Settings</Link> : null}
          </nav>
          <form action={signOut}>
            <button className="rounded border px-3 py-1 text-sm">Sign out</button>
          </form>
        </div>
      </header>
      <div className="mx-auto max-w-6xl p-4">{children}</div>
    </div>
  );
}
