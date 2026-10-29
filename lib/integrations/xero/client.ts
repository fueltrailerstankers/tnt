import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { xeroConfig } from './config';
import { accessToken, recordRate, type Connection } from './connection';
import { readRateHeaders, retryDelayMs, type RateState } from './plan';

// Read-only Xero Accounting API client. It has exactly one request method, GET. M2 must not write to Xero:
// tests/unit/xero-no-writes.test.ts fails if a non-GET request to the accounting API appears in lib/ or app/.

export class XeroApiError extends Error {
  constructor(readonly status: number) {
    super(`Xero API ${status}`);
    this.name = 'XeroApiError';
  }
}

export interface GetOptions {
  params?: Record<string, string>;
  modifiedSince?: string | null;
}

export class XeroReader {
  rate: RateState = { minRemaining: null, dayRemaining: null };
  calls = 0;

  constructor(private db: SupabaseClient, readonly connection: Connection) {}

  /** GET /api.xro/2.0<path>. Retries 429 and 5xx a few times; 401 refreshes the token once. */
  async get<T = Record<string, unknown>>(path: string, opts: GetOptions = {}): Promise<T | null> {
    const url = new URL(`/api.xro/2.0${path}`, xeroConfig().XERO_API_URL);
    for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);
    let refreshed = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const token = await accessToken(this.db, this.connection.id);
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'xero-tenant-id': this.connection.tenantId, Accept: 'application/json' };
      if (opts.modifiedSince) headers['If-Modified-Since'] = new Date(opts.modifiedSince).toUTCString();
      const res = await fetch(url, { method: 'GET', headers, cache: 'no-store' });
      this.calls += 1;
      this.rate = readRateHeaders(res.headers);
      if (this.calls % 10 === 1) await recordRate(this.db, this.connection.id, this.rate.minRemaining, this.rate.dayRemaining);
      if (res.status === 304) return null;
      if (res.ok) return (await res.json()) as T;
      if (res.status === 404) return null;
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.db.from('xero_connections').update({ expires_at: new Date(0).toISOString() }).eq('id', this.connection.id);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        const wait = retryDelayMs(res.headers.get('retry-after'), attempt);
        // Long waits (daily limit, long minute penalty) end this run; the next scheduled run picks up.
        if (wait > 20_000) throw new XeroApiError(res.status);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw new XeroApiError(res.status);
    }
    throw new XeroApiError(429);
  }

  async flushRate() {
    await recordRate(this.db, this.connection.id, this.rate.minRemaining, this.rate.dayRemaining);
  }
}
