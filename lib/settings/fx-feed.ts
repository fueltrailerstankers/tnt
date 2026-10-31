// Daily ZAR -> USD feed (job `fx.refresh`). Pure: URL check, response parser and the write decision.
//
// Provider: env FX_RATE_URL, an https URL answering GET with JSON in this shape (base ZAR):
//   { "base": "ZAR", "rates": { "USD": 0.0547 }, "date": "2026-10-31" }
// `base_code` is accepted for `base` and `time_last_update_utc` for `date` (exchange-rate APIs use those names);
// the USD rate may be a number or a numeric string. The rate must be USD per 1 ZAR within FX_FEED_MIN..FX_FEED_MAX.
//
// app_settings keys (per org):
//   fx.zar_usd             the rate, a positive decimal string (lib/settings/fx.ts), written only while fx.auto = 'on'
//   fx.zar_usd_updated_at  ISO instant of the last write (feed or manual)
//   fx.zar_usd_source      'feed' | 'manual'
//   fx.auto                'on' lets the feed replace the rate; anything else (or missing) keeps the manual rate

import { FX_SETTING_KEY, parseFxInput } from './fx';

export { FX_SETTING_KEY };
export const FX_AUTO_KEY = 'fx.auto';
export const FX_UPDATED_AT_KEY = 'fx.zar_usd_updated_at';
export const FX_SOURCE_KEY = 'fx.zar_usd_source';
export const FX_REFRESH_QUEUE = 'fx.refresh';

/** Sanity bounds for a fetched USD-per-ZAR rate. Outside them the feed is treated as broken and nothing is written. */
export const FX_FEED_MIN = 0.01;
export const FX_FEED_MAX = 1;
/** A feed rate written less than this long ago is fresh: the run skips the org (idempotent re-runs). */
export const FX_FRESH_MS = 20 * 60 * 60 * 1000;

export type FxSource = 'feed' | 'manual';

/** Whether the stored fx.auto value means "on". Only the exact string 'on'. */
export function fxAutoOn(stored: unknown): boolean {
  return stored === 'on';
}

/**
 * The feed URL from the environment, or null when unset or not allowed: https only (http on loopback outside
 * production, for tests). Never logged: it may carry a provider key.
 */
export function fxFeedUrl(raw: string | undefined, production: boolean): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol === 'https:' || (!production && u.protocol === 'http:' && loopback)) return u.toString();
  return null;
}

export type FxFeedError = 'not_object' | 'base_missing' | 'base_not_zar' | 'rate_missing' | 'rate_not_number' | 'rate_out_of_range';
export type FxFeedParse = { ok: true; rate: string; asOf: string | null } | { ok: false; error: FxFeedError };

/** A positive number as the decimal text stored in fx.zar_usd (at most 8 decimals, no trailing zeros). */
export function rateText(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  const s = n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  const p = parseFxInput(s);
  return p.ok && p.value !== null ? p.value : null;
}

/** Parses the provider's JSON body (already JSON.parsed). Error codes only: never echoes the body. */
export function parseFxFeed(body: unknown): FxFeedParse {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'not_object' };
  const o = body as Record<string, unknown>;
  const base = o.base ?? o.base_code;
  if (base === undefined || base === null) return { ok: false, error: 'base_missing' };
  if (typeof base !== 'string' || base.trim().toUpperCase() !== 'ZAR') return { ok: false, error: 'base_not_zar' };
  const rates = o.rates;
  if (!rates || typeof rates !== 'object' || Array.isArray(rates)) return { ok: false, error: 'rate_missing' };
  const raw = (rates as Record<string, unknown>).USD;
  if (raw === undefined || raw === null) return { ok: false, error: 'rate_missing' };
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return { ok: false, error: 'rate_not_number' };
  if (n < FX_FEED_MIN || n > FX_FEED_MAX) return { ok: false, error: 'rate_out_of_range' };
  const rate = rateText(n);
  if (!rate) return { ok: false, error: 'rate_out_of_range' };
  const date = o.date ?? o.time_last_update_utc;
  const asOf = typeof date === 'string' && date.length <= 64 ? date : null;
  return { ok: true, rate, asOf };
}

/** What an org's app_settings say about the rate. */
export interface FxOrgState {
  auto: unknown;
  rate: unknown;
  updatedAt: unknown;
  source: unknown;
}

export type FxSkip = 'auto_off' | 'fresh';

/** Before fetching: whether the org takes the feed now. Skips orgs without fx.auto = 'on' and orgs updated by the feed recently. */
export function fxOrgNeedsRefresh(s: FxOrgState, now: number): { refresh: true } | { refresh: false; reason: FxSkip } {
  if (!fxAutoOn(s.auto)) return { refresh: false, reason: 'auto_off' };
  const at = typeof s.updatedAt === 'string' ? Date.parse(s.updatedAt) : NaN;
  if (s.source === 'feed' && Number.isFinite(at) && now - at >= 0 && now - at < FX_FRESH_MS) return { refresh: false, reason: 'fresh' };
  return { refresh: true };
}

/** The app_settings rows to write for one org after a good fetch, and whether the rate itself changed (audit). */
export function fxWritePlan(s: FxOrgState, rate: string, now: Date): { rows: Array<{ key: string; value: string }>; changed: boolean; from: string | null } {
  const from = typeof s.rate === 'string' ? s.rate.trim() : null;
  const changed = from === null || Number(from) !== Number(rate);
  return {
    rows: [
      ...(changed ? [{ key: FX_SETTING_KEY, value: rate }] : []),
      { key: FX_UPDATED_AT_KEY, value: now.toISOString() },
      { key: FX_SOURCE_KEY, value: 'feed' satisfies FxSource },
    ],
    changed,
    from,
  };
}

/** The Settings toggle: checkbox `fxAuto` posts 'on' when ticked. */
export function parseFxAutoForm(v: unknown): 'on' | 'off' {
  return v === 'on' ? 'on' : 'off';
}

/** "Updated by the daily feed on 31 Oct 2026, 08:00" / "Set by hand on ..." for the Settings page; null when unknown. */
export function fxUpdatedLabel(updatedAt: unknown, source: unknown, timeZone: string): string | null {
  if (typeof updatedAt !== 'string') return null;
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return null;
  let when: string;
  try {
    when = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  } catch {
    when = d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
  return source === 'feed' ? `Updated by the daily feed on ${when}` : `Set by hand on ${when}`;
}
