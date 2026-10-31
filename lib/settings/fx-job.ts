import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordRun } from '@/lib/jobs/outbox';
import {
  FX_AUTO_KEY, FX_REFRESH_QUEUE, FX_SETTING_KEY, FX_SOURCE_KEY, FX_UPDATED_AT_KEY, fxOrgNeedsRefresh, fxWritePlan, parseFxFeed, type FxOrgState,
} from './fx-feed';

// Job `fx.refresh`: once a day, fetch the ZAR -> USD rate from FX_RATE_URL and write it to every org that has
// app_settings fx.auto = 'on' (rules in ./fx-feed). One GET per run, whatever the number of orgs. Service role
// (called from /api/jobs/fx-refresh or the outbox). Logs to job_runs; errors are codes, never the URL or the body.
// Never touches Xero.

export const FX_FETCH_TIMEOUT_MS = 10_000;
export const FX_MAX_BODY = 64 * 1024;

export interface FxRefreshDeps {
  /** The checked feed URL (fxFeedUrl), or null when not configured: the job then does nothing. */
  url: string | null;
  fetch?: typeof fetch;
  now?: () => Date;
}

export type FxRefreshResult =
  | { status: 'not_configured' }
  | { status: 'idle'; skipped: number }
  | { status: 'ok'; written: number; changed: number; skipped: number }
  | { status: 'error'; error: string };

const KEYS = [FX_AUTO_KEY, FX_SETTING_KEY, FX_UPDATED_AT_KEY, FX_SOURCE_KEY];

/** Per-org state from app_settings rows, for orgs that have an fx.auto row. */
async function loadStates(db: SupabaseClient): Promise<Map<string, FxOrgState>> {
  const { data, error } = await db.from('app_settings').select('org_id, key, value').in('key', KEYS);
  if (error) throw new Error('fx: settings could not be read');
  const rows = (data ?? []) as Array<{ org_id: string; key: string; value: unknown }>;
  const out = new Map<string, FxOrgState>();
  for (const r of rows) if (r.key === FX_AUTO_KEY) out.set(r.org_id, { auto: r.value, rate: undefined, updatedAt: undefined, source: undefined });
  for (const r of rows) {
    const s = out.get(r.org_id);
    if (!s) continue;
    if (r.key === FX_SETTING_KEY) s.rate = r.value;
    else if (r.key === FX_UPDATED_AT_KEY) s.updatedAt = r.value;
    else if (r.key === FX_SOURCE_KEY) s.source = r.value;
  }
  return out;
}

/** GET the feed and parse it. Error codes only. */
async function fetchRate(url: string, f: typeof fetch): Promise<{ ok: true; rate: string } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await f(url, { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(FX_FETCH_TIMEOUT_MS) });
  } catch {
    return { ok: false, error: 'fetch_failed' };
  }
  if (!res.ok) return { ok: false, error: `http_${res.status}` };
  let text: string;
  try {
    text = await res.text();
  } catch {
    return { ok: false, error: 'fetch_failed' };
  }
  if (text.length > FX_MAX_BODY) return { ok: false, error: 'too_large' };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: 'bad_json' };
  }
  const p = parseFxFeed(body);
  return p.ok ? { ok: true, rate: p.rate } : { ok: false, error: p.error };
}

/** One run. Idempotent: an org written by the feed in the last 20 hours is skipped; an unchanged rate is not re-audited. */
export async function runFxRefresh(db: SupabaseClient, deps: FxRefreshDeps): Promise<FxRefreshResult> {
  if (!deps.url) return { status: 'not_configured' };
  const url = deps.url;
  const now = deps.now ?? (() => new Date());
  return recordRun<FxRefreshResult>(db, null, FX_REFRESH_QUEUE, async () => {
    const states = await loadStates(db);
    const due: Array<[string, FxOrgState]> = [];
    let skipped = 0;
    for (const [org, s] of states) {
      if (fxOrgNeedsRefresh(s, now().getTime()).refresh) due.push([org, s]);
      else skipped += 1;
    }
    if (!due.length) return { ok: true, processed: 0, result: { status: 'idle', skipped } };

    const got = await fetchRate(url, deps.fetch ?? fetch);
    if (!got.ok) return { ok: false, processed: 0, error: got.error, result: { status: 'error', error: got.error } };

    let written = 0;
    let changed = 0;
    for (const [org, s] of due) {
      const at = now();
      const plan = fxWritePlan(s, got.rate, at);
      const { error } = await db.from('app_settings').upsert(
        plan.rows.map((r) => ({ org_id: org, key: r.key, value: r.value, updated_by: null, updated_at: at.toISOString() })),
        { onConflict: 'org_id,key' },
      );
      if (error) return { ok: false, processed: written, error: 'write_failed', result: { status: 'error', error: 'write_failed' } };
      written += 1;
      if (plan.changed) {
        changed += 1;
        await db.from('audit_log').insert({
          org_id: org, actor_user: null, action: 'settings.fx', entity: 'app_setting', entity_id: FX_SETTING_KEY,
          meta: { from: plan.from, to: got.rate, source: 'feed' },
        });
      }
    }
    return { ok: true, processed: written, result: { status: 'ok', written, changed, skipped } };
  });
}
