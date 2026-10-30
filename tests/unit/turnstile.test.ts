import { describe, expect, it, vi } from 'vitest';
import { verifyTurnstile } from '@/lib/security/turnstile';

const reply = (status: number, json: unknown) => vi.fn(async () => new Response(JSON.stringify(json), { status }));

describe('verifyTurnstile', () => {
  it('passes only when Cloudflare says success', async () => {
    const ok = reply(200, { success: true });
    expect(await verifyTurnstile('tok', '198.51.100.7', 'secret', ok)).toBe(true);
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const body = init.body as URLSearchParams;
    expect([body.get('secret'), body.get('response'), body.get('remoteip')]).toEqual(['secret', 'tok', '198.51.100.7']);
    expect(await verifyTurnstile('tok', null, 'secret', reply(200, { success: false }))).toBe(false);
  });

  it('fails closed on errors and bad input', async () => {
    expect(await verifyTurnstile('tok', null, 'secret', reply(500, { success: true }))).toBe(false);
    expect(await verifyTurnstile('tok', null, 'secret', vi.fn(async () => { throw new Error('network'); }))).toBe(false);
    const never = vi.fn();
    expect(await verifyTurnstile('', null, 'secret', never)).toBe(false);
    expect(await verifyTurnstile(null, null, 'secret', never)).toBe(false);
    expect(await verifyTurnstile('x'.repeat(3000), null, 'secret', never)).toBe(false);
    expect(never).not.toHaveBeenCalled();
  });

  it('does not send an unknown IP', async () => {
    const ok = reply(200, { success: true });
    await verifyTurnstile('tok', 'unknown', 'secret', ok);
    expect(((ok.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams).has('remoteip')).toBe(false);
  });
});
