import { redirect } from 'next/navigation';
import { Logo } from '@/components/ui/Logo';
import { buttonClass } from '@/components/ui/styles';
import { safeNext } from '@/lib/security/safe-next';
import { ConfirmQuery } from '@/lib/users/rules';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Accept invitation · Trailers & Tankers', referrer: 'no-referrer' as const, robots: { index: false, follow: false } };

/**
 * Where invite links land (via GET /auth/confirm). Opening this page does not use the one-time link, so a mail
 * scanner that opens it first does no harm; the Continue button posts the token to /auth/confirm, which verifies it.
 */
export default async function AcceptInvite({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string; next?: string }> }) {
  const sp = await searchParams;
  const parsed = ConfirmQuery.safeParse({ token_hash: sp.token_hash, type: sp.type });
  if (!parsed.success) redirect('/login?error=link');
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4 text-fg">
      <form method="post" action="/auth/confirm" className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-surface p-8 shadow-overlay">
        <div className="space-y-3">
          <div className="-mx-8 -mt-8 mb-2 flex items-center rounded-t-lg bg-side px-8 py-4">
            <Logo variant="on-dark" height={40} />
          </div>
          <h1 className="text-h1">You&apos;re invited</h1>
          <p className="text-body text-fg-muted">Press Continue to accept the invitation to Trailers &amp; Tankers and set your password.</p>
        </div>
        <input type="hidden" name="token_hash" value={parsed.data.token_hash} />
        <input type="hidden" name="type" value={parsed.data.type} />
        {sp.next ? <input type="hidden" name="next" value={safeNext(sp.next)} /> : null}
        <button type="submit" className={buttonClass('primary', 52, 'w-full')}>Continue</button>
      </form>
    </main>
  );
}
