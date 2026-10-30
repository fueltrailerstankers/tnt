// Cloudflare Turnstile check for public form submissions (BUILD_PLAN 5.3). Server only; never log the token or IP.

export const TURNSTILE_FIELD = 'cf-turnstile-response';
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** True only when Cloudflare confirms the token. Any error, timeout or malformed input counts as a failure. */
export async function verifyTurnstile(token: unknown, ip: string | null, secret: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip && ip !== 'unknown') body.set('remoteip', ip);
  try {
    const res = await fetchImpl(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: unknown };
    return json.success === true;
  } catch {
    return false;
  }
}
