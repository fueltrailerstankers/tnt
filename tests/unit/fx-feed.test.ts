import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  FX_FRESH_MS, fxAutoOn, fxFeedUrl, fxOrgNeedsRefresh, fxUpdatedLabel, fxWritePlan, parseFxAutoForm, parseFxFeed, rateText,
} from '@/lib/settings/fx-feed';
import { runFxRefresh } from '@/lib/settings/fx-job';
import { fxRateOf } from '@/lib/settings/fx';
import { FakeSupabase, type Row } from './fake-supabase';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const ORG_B = '00000000-0000-4000-8000-0000000000b2';
const ORG_C = '00000000-0000-4000-8000-0000000000c3';
const NOW = new Date('2026-10-31T04:17:00Z');
const URL_OK = 'https://fx.example.invalid/latest/ZAR?key=abc';

describe('feed URL', () => {
  it('needs https (http on loopback outside production) and no credentials', () => {
    expect(fxFeedUrl(undefined, true)).toBeNull();
    expect(fxFeedUrl('  ', true)).toBeNull();
    expect(fxFeedUrl('not a url', true)).toBeNull();
    expect(fxFeedUrl(URL_OK, true)).toBe(URL_OK);
    expect(fxFeedUrl('http://fx.example.invalid/x', false)).toBeNull();
    expect(fxFeedUrl('http://127.0.0.1:9999/fx', false)).toBe('http://127.0.0.1:9999/fx');
    expect(fxFeedUrl('http://127.0.0.1:9999/fx', true)).toBeNull();
    expect(fxFeedUrl('https://user:pw@fx.example.invalid/', true)).toBeNull();
    expect(fxFeedUrl('ftp://fx.example.invalid/', false)).toBeNull();
  });
});

describe('parseFxFeed', () => {
  it('reads the documented shape', () => {
    expect(parseFxFeed({ base: 'ZAR', rates: { USD: 0.0547, EUR: 0.05 }, date: '2026-10-31' })).toEqual({ ok: true, rate: '0.0547', asOf: '2026-10-31' });
    expect(parseFxFeed({ base_code: 'zar', rates: { USD: '0.054321987' } })).toEqual({ ok: true, rate: '0.05432199', asOf: null });
    expect(parseFxFeed({ base: 'ZAR', rates: { USD: 1 } })).toEqual({ ok: true, rate: '1', asOf: null });
  });

  it('refuses anything else with a code', () => {
    const err = (b: unknown) => { const r = parseFxFeed(b); return r.ok ? 'ok' : r.error; };
    expect(err(null)).toBe('not_object');
    expect(err([1])).toBe('not_object');
    expect(err('0.05')).toBe('not_object');
    expect(err({ rates: { USD: 0.05 } })).toBe('base_missing');
    expect(err({ base: 'USD', rates: { ZAR: 18.3 } })).toBe('base_not_zar');
    expect(err({ base: 'ZAR' })).toBe('rate_missing');
    expect(err({ base: 'ZAR', rates: { EUR: 0.05 } })).toBe('rate_missing');
    expect(err({ base: 'ZAR', rates: { USD: 'abc' } })).toBe('rate_not_number');
    expect(err({ base: 'ZAR', rates: { USD: '1e-2' } })).toBe('rate_not_number');
    expect(err({ base: 'ZAR', rates: { USD: Number.NaN } })).toBe('rate_not_number');
    expect(err({ base: 'ZAR', rates: { USD: 18.3 } })).toBe('rate_out_of_range');
    expect(err({ base: 'ZAR', rates: { USD: 0.001 } })).toBe('rate_out_of_range');
    expect(err({ base: 'ZAR', rates: { USD: -0.05 } })).toBe('rate_out_of_range');
  });

  it('stores rates the settings validator accepts', () => {
    for (const n of [0.01, 0.0547, 0.123456789, 1]) expect(fxRateOf(rateText(n))).toBeCloseTo(n, 7);
    expect(rateText(0)).toBeNull();
    expect(rateText(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('decision rules', () => {
  const t = NOW.getTime();
  it('only fx.auto = on takes the feed; a manual rate is never overwritten otherwise', () => {
    expect(fxAutoOn('on')).toBe(true);
    for (const v of ['off', 'ON', true, null, undefined]) expect(fxAutoOn(v)).toBe(false);
    expect(fxOrgNeedsRefresh({ auto: 'off', rate: '0.05', updatedAt: undefined, source: 'manual' }, t)).toEqual({ refresh: false, reason: 'auto_off' });
    expect(fxOrgNeedsRefresh({ auto: 'on', rate: '0.05', updatedAt: NOW.toISOString(), source: 'manual' }, t)).toEqual({ refresh: true });
  });

  it('skips an org the feed updated in the last 20 hours', () => {
    const recent = new Date(t - FX_FRESH_MS + 60_000).toISOString();
    const old = new Date(t - FX_FRESH_MS - 1).toISOString();
    expect(fxOrgNeedsRefresh({ auto: 'on', rate: '0.05', updatedAt: recent, source: 'feed' }, t)).toEqual({ refresh: false, reason: 'fresh' });
    expect(fxOrgNeedsRefresh({ auto: 'on', rate: '0.05', updatedAt: old, source: 'feed' }, t)).toEqual({ refresh: true });
    expect(fxOrgNeedsRefresh({ auto: 'on', rate: '0.05', updatedAt: 'junk', source: 'feed' }, t)).toEqual({ refresh: true });
  });

  it('plans the rows and audits only a changed rate', () => {
    const same = fxWritePlan({ auto: 'on', rate: '0.0547', updatedAt: undefined, source: 'manual' }, '0.05470', NOW);
    expect(same.changed).toBe(false);
    expect(same.rows.map((r) => r.key)).toEqual(['fx.zar_usd_updated_at', 'fx.zar_usd_source']);
    const diff = fxWritePlan({ auto: 'on', rate: undefined, updatedAt: undefined, source: undefined }, '0.055', NOW);
    expect(diff).toMatchObject({ changed: true, from: null });
    expect(diff.rows).toEqual([
      { key: 'fx.zar_usd', value: '0.055' }, { key: 'fx.zar_usd_updated_at', value: NOW.toISOString() }, { key: 'fx.zar_usd_source', value: 'feed' },
    ]);
  });

  it('parses the toggle and labels the last update', () => {
    expect(parseFxAutoForm('on')).toBe('on');
    expect(parseFxAutoForm(null)).toBe('off');
    expect(parseFxAutoForm('yes')).toBe('off');
    expect(fxUpdatedLabel('2026-10-31T06:00:00Z', 'feed', 'Africa/Johannesburg')).toBe('Updated by the daily feed on 31 Oct 2026, 08:00');
    expect(fxUpdatedLabel('2026-10-31T06:00:00Z', 'manual', 'Africa/Johannesburg')).toBe('Set by hand on 31 Oct 2026, 08:00');
    expect(fxUpdatedLabel(undefined, 'feed', 'UTC')).toBeNull();
    expect(fxUpdatedLabel('junk', 'feed', 'UTC')).toBeNull();
  });
});

function settings(rows: Array<[string, string, unknown]>): Row[] {
  return rows.map(([org_id, key, value]) => ({ org_id, key, value }));
}

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function setting(fake: FakeSupabase, org: string, key: string) {
  return fake.tables.app_settings.find((r) => r.org_id === org && r.key === key)?.value;
}

describe('runFxRefresh', () => {
  const base = () => new FakeSupabase({
    app_settings: settings([
      [ORG_A, 'fx.auto', 'on'], [ORG_A, 'fx.zar_usd', '0.0500'], [ORG_A, 'fx.zar_usd_source', 'manual'],
      [ORG_B, 'fx.auto', 'off'], [ORG_B, 'fx.zar_usd', '0.0600'],
      [ORG_C, 'fx.zar_usd', '0.0700'],
    ]),
    job_runs: [], audit_log: [],
  });

  it('does nothing (no fetch, no job row) without FX_RATE_URL', async () => {
    const fake = base();
    const f = fakeFetch({ base: 'ZAR', rates: { USD: 0.055 } });
    expect(await runFxRefresh(fake.client, { url: null, fetch: f, now: () => NOW })).toEqual({ status: 'not_configured' });
    expect(f).not.toHaveBeenCalled();
    expect(fake.tables.job_runs).toHaveLength(0);
  });

  it('writes the rate only for orgs with fx.auto on, audits it and logs the run', async () => {
    const fake = base();
    const f = fakeFetch({ base: 'ZAR', rates: { USD: 0.055 } });
    expect(await runFxRefresh(fake.client, { url: URL_OK, fetch: f, now: () => NOW })).toEqual({ status: 'ok', written: 1, changed: 1, skipped: 1 });
    expect(f).toHaveBeenCalledTimes(1);
    expect(setting(fake, ORG_A, 'fx.zar_usd')).toBe('0.055');
    expect(setting(fake, ORG_A, 'fx.zar_usd_source')).toBe('feed');
    expect(setting(fake, ORG_A, 'fx.zar_usd_updated_at')).toBe(NOW.toISOString());
    // Manual rates stay as typed.
    expect(setting(fake, ORG_B, 'fx.zar_usd')).toBe('0.0600');
    expect(setting(fake, ORG_C, 'fx.zar_usd')).toBe('0.0700');
    expect(fake.tables.audit_log).toEqual([expect.objectContaining({ org_id: ORG_A, action: 'settings.fx', actor_user: null, meta: { from: '0.0500', to: '0.055', source: 'feed' } })]);
    expect(fake.tables.job_runs).toEqual([expect.objectContaining({ job: 'fx.refresh', ok: true, processed: 1, error: null })]);
    // Every write is scoped to the org and key.
    for (const c of fake.calls('app_settings').filter((l) => l.op === 'upsert')) for (const r of c.rows ?? []) expect(r.org_id).toBe(ORG_A);
  });

  it('is idempotent: a second run the same day fetches nothing', async () => {
    const fake = base();
    const f = fakeFetch({ base: 'ZAR', rates: { USD: 0.055 } });
    await runFxRefresh(fake.client, { url: URL_OK, fetch: f, now: () => NOW });
    const later = new Date(NOW.getTime() + 3600_000);
    expect(await runFxRefresh(fake.client, { url: URL_OK, fetch: f, now: () => later })).toEqual({ status: 'idle', skipped: 2 });
    expect(f).toHaveBeenCalledTimes(1);
    expect(fake.tables.audit_log).toHaveLength(1);
  });

  it('does not fetch when no org has the feed on', async () => {
    const fake = new FakeSupabase({ app_settings: settings([[ORG_B, 'fx.auto', 'off'], [ORG_B, 'fx.zar_usd', '0.06']]), job_runs: [], audit_log: [] });
    const f = fakeFetch({});
    expect(await runFxRefresh(fake.client, { url: URL_OK, fetch: f, now: () => NOW })).toEqual({ status: 'idle', skipped: 1 });
    expect(f).not.toHaveBeenCalled();
  });

  it('writes nothing on a bad answer and logs a code, never the URL', async () => {
    for (const [f, code] of [
      [fakeFetch({ base: 'ZAR', rates: { USD: 18.2 } }), 'rate_out_of_range'],
      [fakeFetch('<html>', 200), 'bad_json'],
      [fakeFetch({}, 503), 'http_503'],
      [vi.fn(async () => { throw new Error(`connect ${URL_OK}`); }) as unknown as typeof fetch, 'fetch_failed'],
    ] as const) {
      const fake = base();
      expect(await runFxRefresh(fake.client, { url: URL_OK, fetch: f, now: () => NOW })).toEqual({ status: 'error', error: code });
      expect(setting(fake, ORG_A, 'fx.zar_usd')).toBe('0.0500');
      expect(fake.tables.audit_log).toHaveLength(0);
      expect(fake.tables.job_runs).toEqual([expect.objectContaining({ job: 'fx.refresh', ok: false, error: code })]);
      expect(JSON.stringify(fake.tables.job_runs)).not.toContain('example.invalid');
    }
  });

  it('refreshes the timestamp without an audit row when the rate is unchanged', async () => {
    const fake = base();
    await runFxRefresh(fake.client, { url: URL_OK, fetch: fakeFetch({ base: 'ZAR', rates: { USD: 0.05 } }), now: () => NOW });
    expect(setting(fake, ORG_A, 'fx.zar_usd')).toBe('0.0500');
    expect(setting(fake, ORG_A, 'fx.zar_usd_source')).toBe('feed');
    expect(fake.tables.audit_log).toHaveLength(0);
  });
});
