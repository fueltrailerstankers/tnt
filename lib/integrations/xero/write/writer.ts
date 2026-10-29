import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { xeroConfig } from '../config';
import { accessToken, recordRate, type Connection } from '../connection';
import { readRateHeaders, retryDelayMs, type RateState } from '../plan';
import { fillPlaceholders, pick, type FileSource, type Plan, type PlannedRequest, type WriteMethod } from './types';

// THE ONLY PLACE that sends non-GET requests to the Xero accounting API (tests/unit/xero-no-writes.test.ts).
//
// Every write is a PlannedRequest. In dry_run, send() records it and returns a synthetic response: no network.
// In live, send() needs a Claim for exactly that request (action_claims row, unique org + action_key), which
// only claim() can issue. A claim is completed with the result (so a replay reuses it) or marked rejected
// when Xero refused the request (4xx: nothing was written, a later run may try again). A claim left without a
// result means the outcome is unknown (crash, timeout, 5xx after retries): the action stops and needs review,
// so a retry can never double-write. Xero's Idempotency-Key header (derived from the claim key) is sent too.
// Methods are POST and PUT only. There is no delete: we never delete Xero records.

const WRITE_METHODS: ReadonlySet<string> = new Set<WriteMethod>(['POST', 'PUT']);

export class XeroWriteError extends Error {
  constructor(readonly status: number, readonly xeroType?: string) {
    super(`Xero write ${status}`);
    this.name = 'XeroWriteError';
  }
}

/** The writer refused to send (no claim, wrong claim, not live, bad request). Never reaches the network. */
export class WriterRefused extends Error {
  constructor(reason: string) {
    super(`writer refused: ${reason}`);
    this.name = 'WriterRefused';
  }
}

/** A step was claimed earlier but has no recorded result: the outcome is unknown. Check Xero, then release. */
export class ClaimHeld extends Error {
  constructor(readonly key: string) {
    super('claim held without a result: check Xero, then release the claim');
    this.name = 'ClaimHeld';
  }
}

/** A claimed action key. Only XeroWriter.claim() creates them; send() checks the brand. */
export class Claim {
  private constructor(readonly orgId: string, readonly key: string) {}
  /** @internal */
  static issue(orgId: string, key: string): Claim {
    const c = new Claim(orgId, key);
    ISSUED.add(c);
    return c;
  }
}
const ISSUED = new WeakSet<Claim>();
const COMPLETED = new WeakSet<Claim>();

export interface ClaimResult {
  status: 'done' | 'rejected';
  http?: number;
  captures?: Record<string, string>;
}

export type ClaimOutcome = { claim: Claim } | { done: ClaimResult } | { held: true };

/** A request ready to send: placeholders filled, raw body loaded. */
export interface ResolvedRequest {
  step: string;
  method: WriteMethod;
  path: string;
  params?: Record<string, string>;
  json?: unknown;
  raw?: { bytes: Buffer; contentType: string };
  /** action_claims key this request is sent under. */
  claimKey: string;
}

export interface SendResult {
  status: number;
  dryRun: boolean;
  json: unknown;
}

export interface WriterDeps {
  db: SupabaseClient;
  orgId: string;
  mode: 'dry_run' | 'live';
  connection: Connection | null;
  /** Injected in tests. Defaults: accessToken() from connection.ts, global fetch, XERO_API_URL. */
  token?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  apiUrl?: string;
  sleep?: (ms: number) => Promise<void>;
}

export interface RecordedRequest {
  step: string;
  method: WriteMethod;
  path: string;
  dryRun: boolean;
  status: number | null;
}

export class XeroWriter {
  readonly recorded: RecordedRequest[] = [];
  rate: RateState = { minRemaining: null, dayRemaining: null };
  private calls = 0;

  constructor(private deps: WriterDeps) {}

  get mode() {
    return this.deps.mode;
  }

  // -------------------------------------------------------------------------------------------
  // Claims (live only)
  // -------------------------------------------------------------------------------------------
  async claim(key: string): Promise<ClaimOutcome> {
    if (this.deps.mode !== 'live') throw new WriterRefused('claims are for live mode');
    const { db, orgId } = this.deps;
    const ins = await db.from('action_claims').insert({ org_id: orgId, action_key: key }).select('id');
    if (!ins.error && ins.data?.length) return { claim: Claim.issue(orgId, key) };
    if (ins.error && ins.error.code !== '23505') throw new Error('could not claim the action');
    const { data } = await db.from('action_claims').select('result').eq('org_id', orgId).eq('action_key', key).maybeSingle();
    const result = (data?.result ?? null) as ClaimResult | null;
    if (result?.status === 'done') return { done: result };
    if (result?.status === 'rejected') {
      // Xero refused it last time, so nothing was written: take the claim over (conditional, so only one run wins).
      const { data: took } = await db.from('action_claims').update({ result: null, claimed_at: new Date().toISOString() })
        .eq('org_id', orgId).eq('action_key', key).eq('result->>status', 'rejected').select('id');
      if (took?.length) return { claim: Claim.issue(orgId, key) };
    }
    return { held: true };
  }

  async complete(claim: Claim, result: ClaimResult): Promise<void> {
    this.check(claim);
    const { error } = await this.deps.db.from('action_claims').update({ result }).eq('org_id', claim.orgId).eq('action_key', claim.key);
    if (error) throw new Error('could not record the claim result');
    COMPLETED.add(claim);
  }

  private check(claim: Claim) {
    if (!ISSUED.has(claim) || claim.orgId !== this.deps.orgId) throw new WriterRefused('not a claim issued by this writer');
  }

  // -------------------------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------------------------
  async send(req: ResolvedRequest, claim: Claim | null): Promise<SendResult> {
    if (!WRITE_METHODS.has(req.method)) throw new WriterRefused(`method ${req.method}`);
    if (!req.path.startsWith('/') || req.path.includes('..') || req.path.includes('{{')) throw new WriterRefused('bad path');

    if (this.deps.mode === 'dry_run') {
      this.recorded.push({ step: req.step, method: req.method, path: req.path, dryRun: true, status: null });
      return { status: 0, dryRun: true, json: { dryRun: true } };
    }
    if (this.deps.mode !== 'live') throw new WriterRefused('not live');
    if (!claim) throw new WriterRefused('live send without a claimed key');
    this.check(claim);
    if (COMPLETED.has(claim)) throw new WriterRefused('claim already used');
    if (claim.key !== req.claimKey) throw new WriterRefused('claim does not match the request');
    const conn = this.deps.connection;
    if (!conn || conn.status !== 'connected') throw new WriterRefused('Xero not connected');

    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const token = this.deps.token ?? (() => accessToken(this.deps.db, conn.id));
    const url = new URL(`/api.xro/2.0${req.path}`, this.deps.apiUrl ?? xeroConfig().XERO_API_URL);
    for (const [k, v] of Object.entries(req.params ?? {})) url.searchParams.set(k, v);
    const idem = createHash('sha256').update(`${claim.orgId}|${claim.key}`).digest('hex');

    let refreshed = false;
    let serverRetries = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${await token()}`,
        'xero-tenant-id': conn.tenantId,
        Accept: 'application/json',
        'Idempotency-Key': idem,
      };
      let body: BodyInit | undefined;
      if (req.raw) {
        headers['Content-Type'] = req.raw.contentType;
        body = new Uint8Array(req.raw.bytes);
      } else if (req.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(req.json);
      }
      const res = await fetchImpl(url, { method: req.method, headers, body, cache: 'no-store' });
      this.calls += 1;
      this.rate = readRateHeaders(res.headers);
      if (this.calls % 5 === 1) await recordRate(this.deps.db, conn.id, this.rate.minRemaining, this.rate.dayRemaining).catch(() => undefined);
      if (res.ok) {
        const json = await res.json().catch(() => null);
        this.recorded.push({ step: req.step, method: req.method, path: req.path, dryRun: false, status: res.status });
        return { status: res.status, dryRun: false, json };
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.deps.db.from('xero_connections').update({ expires_at: new Date(0).toISOString() }).eq('id', conn.id);
        continue;
      }
      // 429: Xero did not process it. 5xx: the Idempotency-Key makes one resend safe.
      if (res.status === 429 || (res.status >= 500 && serverRetries < 1)) {
        if (res.status >= 500) serverRetries++;
        const wait = retryDelayMs(res.headers.get('retry-after'), attempt);
        if (wait > 20_000) throw new XeroWriteError(res.status);
        await sleep(wait);
        continue;
      }
      const err = (await res.json().catch(() => ({}))) as { Type?: string };
      this.recorded.push({ step: req.step, method: req.method, path: req.path, dryRun: false, status: res.status });
      throw new XeroWriteError(res.status, typeof err.Type === 'string' ? err.Type : undefined);
    }
    throw new XeroWriteError(429);
  }

  /** GET a binary document (invoice PDF, attachment content). Reads need no claim; they run in any mode. */
  async download(path: string, accept: string): Promise<Buffer | null> {
    const conn = this.deps.connection;
    if (!conn || conn.status !== 'connected') return null;
    if (!path.startsWith('/') || path.includes('..')) throw new WriterRefused('bad path');
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const token = this.deps.token ?? (() => accessToken(this.deps.db, conn.id));
    const url = new URL(`/api.xro/2.0${path}`, this.deps.apiUrl ?? xeroConfig().XERO_API_URL);
    const res = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${await token()}`, 'xero-tenant-id': conn.tenantId, Accept: accept }, cache: 'no-store' });
    this.calls += 1;
    this.rate = readRateHeaders(res.headers);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
}

// ---------------------------------------------------------------------------------------------------
// Running a plan
// ---------------------------------------------------------------------------------------------------
export type FileLoader = (f: FileSource) => Promise<{ bytes: Buffer; contentType: string } | null>;

export interface StepOutcome {
  step: string;
  outcome: 'dry_run' | 'sent' | 'already_done';
  http?: number;
  ids?: Record<string, string>;
}

export interface ExecResult {
  captures: Record<string, string>;
  steps: StepOutcome[];
}

export const claimKeyOf = (plan: Pick<Plan, 'idempotencyKey'>, r: Pick<PlannedRequest, 'step'>) => `${plan.idempotencyKey}#${r.step}`;

/**
 * Sends a plan's requests in order. dry_run: records each request, synthetic ids for captures, no network and
 * no claims. live: claim each step; reuse done steps; stop on a held claim; mark 4xx refusals as rejected.
 */
export async function executePlan(writer: XeroWriter, plan: Plan, loadFile: FileLoader): Promise<ExecResult> {
  const captures: Record<string, string> = {};
  const steps: StepOutcome[] = [];
  for (const r of plan.requests) {
    const filled = fillPlaceholders({ path: r.path, params: r.params, body: r.body }, captures);
    const base = { step: r.step, method: r.method, path: filled.path, params: filled.params, claimKey: claimKeyOf(plan, r) };
    if (writer.mode === 'dry_run') {
      await writer.send({ ...base, json: filled.body }, null);
      if (r.capture) captures[r.capture.name] = `dry-run-${r.capture.name}`;
      steps.push({ step: r.step, outcome: 'dry_run' });
      continue;
    }
    const c = await writer.claim(base.claimKey);
    if ('done' in c) {
      Object.assign(captures, c.done.captures ?? {});
      steps.push({ step: r.step, outcome: 'already_done', http: c.done.http });
      continue;
    }
    if ('held' in c) throw new ClaimHeld(base.claimKey);
    let raw: ResolvedRequest['raw'];
    if (r.file) {
      const loaded = await loadFile(r.file);
      if (!loaded) {
        await writer.complete(c.claim, { status: 'rejected' });
        throw new Error(`file for ${r.step} is missing`);
      }
      raw = loaded;
    }
    let res: SendResult;
    try {
      res = await writer.send({ ...base, json: r.file ? undefined : filled.body, raw }, c.claim);
    } catch (e) {
      // A refusal from Xero (4xx other than 429) wrote nothing: free the claim for a later attempt.
      if (e instanceof XeroWriteError && e.status >= 400 && e.status < 500 && e.status !== 429) {
        await writer.complete(c.claim, { status: 'rejected', http: e.status });
      }
      throw e;
    }
    const ids: Record<string, string> = {};
    if (r.capture) {
      const v = pick(res.json, r.capture.path);
      if (typeof v === 'string' && v) ids[r.capture.name] = v;
    }
    await writer.complete(c.claim, { status: 'done', http: res.status, captures: ids });
    if (r.capture && !ids[r.capture.name]) throw new Error(`no ${r.capture.name} id in the Xero response`);
    Object.assign(captures, ids);
    steps.push({ step: r.step, outcome: 'sent', http: res.status, ids });
  }
  return { captures, steps };
}
