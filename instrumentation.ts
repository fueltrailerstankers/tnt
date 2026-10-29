// Sentry hook. Inert unless SENTRY_DSN is set.
// Sentry 11 collects user info, cookies, headers, query params and bodies by default. We turn all of it off:
// cookies carry session tokens and bodies carry personal data (ID numbers, emails, file names).
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
  });
}
