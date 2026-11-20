/**
 * Pure: decide what the login page tells the user after a failed password sign-in.
 *
 * Wrong email/password (and anything else account-specific) all read as `credentials`, so the
 * form never reveals which accounts exist. Only failures that hit every account alike, i.e. the
 * auth service itself refusing or unreachable, read as `unavailable`:
 *  - 402: Supabase restricts a project that is over its plan limits (every request answers 402),
 *  - 5xx: auth service errors,
 *  - no status / status 0 / AuthRetryableFetchError: network failure.
 */
export type SignInFailure = 'credentials' | 'unavailable';

export function signInFailureOf(error: { status?: number; name?: string } | null | undefined): SignInFailure {
  if (!error) return 'credentials';
  if (error.name === 'AuthRetryableFetchError') return 'unavailable';
  const status = error.status;
  if (status === undefined || status === 0) return 'unavailable';
  if (status === 402 || status >= 500) return 'unavailable';
  return 'credentials';
}

/** Value of the `error` query parameter on /login for each failure. */
export const LOGIN_ERROR_PARAM: Record<SignInFailure, string> = { credentials: '1', unavailable: 'unavailable' };

/** Copy shown on /login for the `error` query parameter. */
export function loginErrorMessage(param: string): string {
  if (param === 'link') return 'This link is invalid or has expired. Ask an admin for a new invite link.';
  if (param === LOGIN_ERROR_PARAM.unavailable) {
    return 'Sign in is unavailable right now because the service is not responding. Your account is not affected. Try again later or contact your administrator.';
  }
  return 'Sign in failed. Check your email and password.';
}
