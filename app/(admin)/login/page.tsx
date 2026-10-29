import { signIn } from './actions';

export const metadata = { title: 'Sign in · Trailers & Tankers' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <form action={signIn} className="w-full max-w-sm space-y-4 rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Trailers &amp; Tankers</h1>
        <p className="text-sm text-neutral-600">Sign in to the admin area.</p>
        {error ? (
          <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">
            Sign in failed. Check your email and password.
          </p>
        ) : null}
        <input type="hidden" name="next" value={next ?? ''} />
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Email</span>
          <input name="email" type="email" required autoComplete="username" className="w-full rounded border px-3 py-2" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Password</span>
          <input name="password" type="password" required autoComplete="current-password" className="w-full rounded border px-3 py-2" />
        </label>
        <button type="submit" className="w-full rounded bg-neutral-900 px-3 py-2 text-white">
          Sign in
        </button>
      </form>
    </main>
  );
}
