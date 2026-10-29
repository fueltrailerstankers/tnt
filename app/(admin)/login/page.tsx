import { signIn } from './actions';

export const metadata = { title: 'Sign in · Trailers & Tankers' };

const field =
  'w-full rounded-md border border-neutral-300 bg-white px-3 py-2.5 text-base text-neutral-900 placeholder:text-neutral-400 shadow-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/15';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 p-4 text-neutral-900">
      <form
        action={signIn}
        className="w-full max-w-sm space-y-5 rounded-xl border border-neutral-200 bg-white p-8 shadow-lg"
      >
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Trailers &amp; Tankers</h1>
          <p className="text-sm text-neutral-600">Sign in to the admin area.</p>
        </div>
        {error ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Sign in failed. Check your email and password.
          </p>
        ) : null}
        <input type="hidden" name="next" value={next ?? ''} />
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-neutral-800">Email</span>
          <input name="email" type="email" required autoComplete="username" className={field} />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-neutral-800">Password</span>
          <input name="password" type="password" required autoComplete="current-password" className={field} />
        </label>
        <button
          type="submit"
          className="w-full rounded-md bg-neutral-900 px-3 py-2.5 text-base font-medium text-white transition hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900/30 focus:ring-offset-2"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
