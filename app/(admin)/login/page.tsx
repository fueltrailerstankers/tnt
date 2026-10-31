import { Input, Label } from '@/components/ui/Field';
import { Logo } from '@/components/ui/Logo';
import { buttonClass } from '@/components/ui/styles';
import { signIn } from './actions';

export const metadata = { title: 'Sign in · Trailers & Tankers' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4 text-fg">
      <form action={signIn} className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-surface p-8 shadow-overlay">
        <div className="space-y-3">
          <div className="-mx-8 -mt-8 mb-2 flex items-center rounded-t-lg bg-side px-8 py-4">
            <Logo variant="on-dark" height={40} />
          </div>
          <h1 className="text-h1">Trailers &amp; Tankers</h1>
          <p className="text-body text-fg-muted">Sign in to the admin area.</p>
        </div>
        {error ? (
          <p role="alert" className="rounded-sm bg-status-red-bg p-3 text-body font-semibold text-status-red-fg">
            {error === 'link'
              ? 'This link is invalid or has expired. Ask an admin for a new invite link.'
              : 'Sign in failed. Check your email and password.'}
          </p>
        ) : null}
        <input type="hidden" name="next" value={next ?? ''} />
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required autoComplete="username" />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        <button type="submit" className={buttonClass('primary', 52, 'w-full')}>Sign in</button>
      </form>
    </main>
  );
}
