// Cognito Forms REST API implementation of CognitoSource.
//
// The exact REST shape is NOT verified against a live key. Every assumption is tagged (A1..A13) here and listed in
// docs/M5.md, with how to check it. Only this file knows URLs; fix it here if Cognito differs, the mapper and the
// importer do not change.
//
//   A1  Base URL https://www.cognitoforms.com/api, auth header "Authorization: Bearer <COGNITO_API_KEY>".
//   A2  "Get entry": GET /forms/{formId}/entries/{entryNumber} returns one entry as JSON; 404 when it does not
//       exist (deleted). {formId} accepts the numeric Cognito form id from the spec (e.g. 4 for RFI).
//   A3  "List entries" (only with listMode 'list'): GET /forms/{formId}/entries?skip=N&take=M returns an array
//       (or { Entries | value | items: [...] }). Not confirmed to exist; 'by-number' (A2) is the default.
//   A6  Files: an entry's file object has a `File` URL that can be fetched with the same bearer key, or an `Id`
//       that GET /files/{id} resolves (bytes, or JSON with a download URL).
//   A13 Rate limits are unknown: 429 and 5xx are retried with backoff, honouring Retry-After.
//   A14 "List forms": GET /forms returns [{ Id, Name, InternalName, ... }] (used by Test connection in the app).
//   A15 The form list may carry an entry count (EntryCount or similar); if not, counts come from a dry run.
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { MAX_FILE_BYTES } from '@/lib/spec/values';
import type {
  CognitoEntry, CognitoFileRef, CognitoFormInfo, CognitoFormRef, CognitoSource, DownloadedFile, ListOptions, PositionedEntry, SourcePosition,
} from './source';
import { decodeInline, FileTooLargeError, SourceDeadlineError } from './source';

export const COGNITO_API_BASE = 'https://www.cognitoforms.com/api';
const MAX_REDIRECTS = 3;
/** File metadata JSON (A6) is small; anything bigger is not metadata. */
const MAX_METADATA_BYTES = 1024 * 1024;

export interface HttpSourceOptions {
  apiKey: string;
  baseUrl?: string;
  /** 'by-number' walks Entry.Number 1..N with "get entry" (A2); 'list' pages the list endpoint (A3). */
  listMode?: 'by-number' | 'list';
  /** by-number: stop after this many consecutive missing numbers (deleted entries leave gaps). */
  maxConsecutiveMisses?: number;
  /** by-number: never look past this entry number. */
  maxNumber?: number;
  pageSize?: number;
  retries?: number;
  /**
   * Hard end of the current step (ms since epoch). Every request carries an AbortSignal that fires then, and a retry
   * wait that would run past it throws SourceDeadlineError instead of sleeping. Unset (CLI): no limit.
   */
  deadline?: number;
  /** Largest file accepted, in bytes (default MAX_FILE_BYTES): a bigger Content-Length or body throws FileTooLargeError. */
  maxFileBytes?: number;
  /** Host name -> IP addresses (tests replace it). Used to refuse private targets for storage hosts. */
  lookup?: (host: string) => Promise<string[]>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Errors carry the status and path only: never response bodies, which may contain entry data. */
export class CognitoApiError extends Error {
  constructor(readonly status: number, what: string) {
    super(`Cognito API ${what} failed with HTTP ${status}`);
  }
}

const COGNITO_HOST = /(^|\.)cognitoforms\.com$/i;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The API base to use for an override (COGNITO_API_URL). Accepted only when it is https on a cognitoforms.com host,
 * or plain http on loopback outside production (tests' mock). Anything else is ignored: the default is used.
 */
export function cognitoApiBase(raw: string | undefined, production: boolean): { base: string; ignored: boolean } {
  const v = raw?.trim();
  if (!v) return { base: COGNITO_API_BASE, ignored: false };
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { base: COGNITO_API_BASE, ignored: true };
  }
  const clean = !u.username && !u.password && !u.search && !u.hash;
  const ok = clean && ((u.protocol === 'https:' && COGNITO_HOST.test(u.hostname)) || (!production && u.protocol === 'http:' && LOOPBACK.has(u.hostname)));
  return ok ? { base: u.href.replace(/\/+$/, ''), ignored: false } : { base: COGNITO_API_BASE, ignored: true };
}

function v4Private(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 // this network, private, loopback, multicast and reserved
    || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
    || (a === 169 && b === 254) // link-local (cloud metadata)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) // private
    || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)); // IETF, benchmarking
}

/** True for loopback, private, link-local, CGNAT, multicast, unspecified and other non-public addresses. */
export function privateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return v4Private(ip);
  if (kind !== 6) return true;
  const x = ip.toLowerCase();
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4Private(mapped[1]);
  return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x) || x.startsWith('::ffff:') || x.startsWith('64:ff9b:');
}

const defaultLookup = async (host: string) => (await dnsLookup(host, { all: true })).map((a) => a.address);

export class HttpCognitoSource implements CognitoSource {
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxFileBytes: number;

  constructor(private readonly o: HttpSourceOptions) {
    if (!o.apiKey) throw new Error('COGNITO_API_KEY is not set');
    this.base = (o.baseUrl ?? COGNITO_API_BASE).replace(/\/+$/, '');
    this.f = o.fetch ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxFileBytes = o.maxFileBytes ?? MAX_FILE_BYTES;
  }

  /** The bearer key goes only to Cognito hosts, never to a storage URL found in entry data. */
  private headers(url: string, accept: string): Record<string, string> {
    const h: Record<string, string> = { Accept: accept };
    const u = new URL(url);
    if (url.startsWith(`${this.base}/`) || (u.protocol === 'https:' && COGNITO_HOST.test(u.hostname))) h.Authorization = `Bearer ${this.o.apiKey}`;
    return h;
  }

  /**
   * URLs taken from entry data or file metadata: https only, Cognito hosts or the API base host. A storage host
   * named in Cognito's own metadata is allowed for the second hop (it never gets the bearer key, see headers()).
   */
  private allowedFileUrl(raw: string, fromMetadata = false): boolean {
    let u: URL;
    try { u = new URL(raw); } catch { return false; }
    if (u.protocol !== 'https:' && u.href.indexOf(this.base) !== 0) return false;
    if (fromMetadata) return u.protocol === 'https:';
    return COGNITO_HOST.test(u.hostname) || u.hostname === new URL(this.base).hostname;
  }

  /** Parses a JSON body without letting a parser message (which can quote the body) reach the logs. */
  private async json(res: Response, what: string): Promise<unknown> {
    try { return await res.json(); } catch { throw new CognitoApiError(res.status, `${what}: invalid JSON`); }
  }

  /** A storage host named by Cognito (A6): never an IP literal or local name, and every address it resolves to is public. */
  private async publicHost(raw: string): Promise<boolean> {
    const host = new URL(raw).hostname.toLowerCase();
    const bare = host.replace(/^\[|\]$/g, '');
    if (!bare || bare === 'localhost' || /\.(localhost|local|internal|home|lan)$/.test(bare) || isIP(bare)) return false;
    try {
      const addrs = await (this.o.lookup ?? defaultLookup)(bare);
      return addrs.length > 0 && addrs.every((a) => !privateAddress(a));
    } catch {
      return false;
    }
  }

  /** Where a redirect may go: API calls stay on Cognito (or the API base host); file downloads may also go to a public https storage host. */
  private async redirectAllowed(next: string, policy: 'api' | 'file'): Promise<boolean> {
    if (this.allowedFileUrl(next)) return true;
    return policy === 'file' && this.allowedFileUrl(next, true) && (await this.publicHost(next));
  }

  private deadlinePassed(): boolean {
    return this.o.deadline !== undefined && Date.now() >= this.o.deadline;
  }

  /** One HTTP exchange, aborted at the step deadline. */
  private async fetchOnce(url: string, accept: string): Promise<Response> {
    let signal: AbortSignal | undefined;
    if (this.o.deadline !== undefined) {
      const left = this.o.deadline - Date.now();
      if (left <= 0) throw new SourceDeadlineError('step_deadline');
      signal = AbortSignal.timeout(left);
    }
    try {
      return await this.f(url, { headers: this.headers(url, accept), redirect: 'manual', signal });
    } catch (e) {
      if (signal?.aborted || this.deadlinePassed()) throw new SourceDeadlineError('step_deadline');
      throw e;
    }
  }

  /** Follows up to MAX_REDIRECTS redirects by hand, checking every target (and re-deciding where the key goes). */
  private async fetchFollowing(url: string, what: string, accept: string, policy: 'api' | 'file'): Promise<Response> {
    let current = url;
    for (let hop = 0; ; hop++) {
      const res = await this.fetchOnce(current, accept);
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc) return res;
      await res.body?.cancel().catch(() => undefined);
      let next: string;
      try {
        next = new URL(loc, current).href;
      } catch {
        throw new CognitoApiError(res.status, `${what}: bad redirect`);
      }
      if (hop >= MAX_REDIRECTS) throw new CognitoApiError(res.status, `${what}: too many redirects`);
      if (!(await this.redirectAllowed(next, policy))) throw new CognitoApiError(res.status, `${what}: redirect target not allowed`);
      current = next;
    }
  }

  private async request(url: string, what: string, accept = 'application/json', allow404 = false, policy: 'api' | 'file' = 'api'): Promise<Response | null> {
    const retries = this.o.retries ?? 5;
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFollowing(url, what, accept, policy);
      if (res.ok) return res;
      await res.body?.cancel().catch(() => undefined);
      if (res.status === 404 && allow404) return null;
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) * 1000 : Math.min(2 ** attempt * 500, 30_000) + Math.random() * 250;
        const code = res.status === 429 ? 'cognito_rate_limited' : 'cognito_unavailable';
        // In a job (deadline set), never sleep past the step and never fail the run on a busy Cognito: hand the wait
        // to the job, which retries the run later with growing waits (retryWaitMs) up to MAX_WAIT_ATTEMPTS.
        if (this.o.deadline !== undefined && (attempt >= retries || Date.now() + wait >= this.o.deadline)) {
          throw new SourceDeadlineError(code, Math.round(wait));
        }
        if (attempt < retries) {
          await this.sleep(wait);
          continue;
        }
      }
      if (res.status === 401 || res.status === 403) throw new CognitoApiError(res.status, `${what} (check COGNITO_API_KEY and its scopes)`);
      throw new CognitoApiError(res.status, what);
    }
  }

  /** Reads a body up to `cap` bytes: a larger Content-Length is refused unread, a longer stream is cut off. */
  private async readCapped(res: Response, cap: number): Promise<Uint8Array> {
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > cap) {
      await res.body?.cancel().catch(() => undefined);
      throw new FileTooLargeError();
    }
    if (!res.body) return new Uint8Array(await res.arrayBuffer());
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > cap) {
          await reader.cancel().catch(() => undefined);
          throw new FileTooLargeError();
        }
        chunks.push(value);
      }
    } catch (e) {
      if (e instanceof FileTooLargeError) throw e;
      if (this.deadlinePassed()) throw new SourceDeadlineError('step_deadline');
      throw e;
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  }

  async *listEntries(form: CognitoFormRef, opts: ListOptions): AsyncIterable<CognitoEntry> {
    for await (const step of this.listPositioned(form, opts)) if (step.entry) yield step.entry;
  }

  /** Resumable read (see SourcePosition). A position from the other list mode is ignored: the read starts over. */
  async *listPositioned(form: CognitoFormRef, opts: ListOptions & { from?: SourcePosition | null }): AsyncIterable<PositionedEntry> {
    // since is applied by the importer; no server-side filter is assumed
    const from = opts.from ?? null;
    if ((this.o.listMode ?? 'by-number') === 'list') {
      yield* this.listPaged(form, from?.kind === 'skip' ? from.n : 0);
      return;
    }
    const maxMisses = this.o.maxConsecutiveMisses ?? 200;
    let misses = from?.kind === 'number' ? from.misses : 0;
    if (misses >= maxMisses) return;
    for (let n = from?.kind === 'number' ? from.next : 1; this.o.maxNumber === undefined || n <= this.o.maxNumber; n++) {
      const res = await this.request(`${this.base}/forms/${form.cognitoFormId}/entries/${n}`, `get entry (form ${form.slug})`, 'application/json', true);
      if (!res) {
        misses++;
        // A miss is yielded too, so a long run of deleted numbers can be paused and resumed.
        yield { entry: null, position: { kind: 'number', next: n + 1, misses } };
        if (misses >= maxMisses) return;
        continue;
      }
      misses = 0;
      const body = await this.json(res, `get entry (form ${form.slug})`);
      const entry = body && typeof body === 'object' && !Array.isArray(body) ? (body as CognitoEntry) : null;
      yield { entry, position: { kind: 'number', next: n + 1, misses: 0 } };
    }
  }

  private async *listPaged(form: CognitoFormRef, start: number): AsyncIterable<PositionedEntry> {
    const take = this.o.pageSize ?? 100;
    for (let skip = start; ; skip += take) {
      const res = await this.request(`${this.base}/forms/${form.cognitoFormId}/entries?skip=${skip}&take=${take}`, `list entries (form ${form.slug})`);
      const body = await this.json(res!, `list entries (form ${form.slug})`);
      const page = Array.isArray(body) ? body : pickArray(body);
      for (const [i, e] of page.entries()) {
        yield { entry: e && typeof e === 'object' && !Array.isArray(e) ? (e as CognitoEntry) : null, position: { kind: 'skip', n: skip + i + 1 } };
      }
      if (page.length < take) return;
    }
  }

  /**
   * A14: GET /forms lists the organisation's forms as [{ Id, Name, InternalName, ... }] (archived forms may be
   * left out). An entry count is used only when the list carries one (A15); otherwise it is null.
   */
  async listForms(): Promise<CognitoFormInfo[]> {
    const res = await this.request(`${this.base}/forms`, 'list forms');
    const body = await this.json(res!, 'list forms');
    const list = Array.isArray(body) ? body : pickArray(body, ['Forms', 'forms', 'value', 'items', 'Items']);
    return list.filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && !Array.isArray(f)).map(formInfo);
  }

  /**
   * Whether the key may read entries of a form (entry read scope): asks for entry 1. 'ok' when Cognito answers
   * with the entry or 404 (no such number); 'denied' on 401/403. The body is discarded unread.
   */
  async probeEntries(form: CognitoFormRef): Promise<'ok' | 'denied'> {
    try {
      const res = await this.request(`${this.base}/forms/${form.cognitoFormId}/entries/1`, `get entry (form ${form.slug})`, 'application/json', true);
      await res?.body?.cancel();
      return 'ok';
    } catch (e) {
      if (e instanceof CognitoApiError && (e.status === 401 || e.status === 403)) return 'denied';
      throw e;
    }
  }

  async downloadFile(ref: CognitoFileRef): Promise<DownloadedFile> {
    const inline = decodeInline(ref);
    if (inline) return inline;
    // A URL from entry data that is not an https Cognito URL is never fetched; the Id route (our own base) is used instead.
    const direct = ref.url && this.allowedFileUrl(ref.url) ? ref.url : null;
    const url = direct ?? (ref.id ? `${this.base}/files/${encodeURIComponent(ref.id)}` : null);
    if (!url) throw new Error(ref.url ? 'file URL is not an https Cognito URL' : 'file has no source');
    let res = (await this.request(url, 'download file', '*/*', false, 'file'))!;
    // A6: the files endpoint may answer with metadata JSON that points at the bytes.
    if ((res.headers.get('content-type') ?? '').includes('application/json')) {
      let meta: Record<string, unknown>;
      try {
        meta = JSON.parse(Buffer.from(await this.readCapped(res, MAX_METADATA_BYTES)).toString('utf8')) as Record<string, unknown>;
      } catch (e) {
        if (e instanceof SourceDeadlineError) throw e;
        throw new CognitoApiError(res.status, 'download file: invalid JSON');
      }
      const next = [meta?.File, meta?.Url, meta?.DownloadUrl, meta?.url].find((v): v is string => typeof v === 'string' && /^https:\/\//.test(v));
      if (!next) throw new Error('file metadata without a download URL');
      // Cognito's own hosts as before; any other storage host must be public (no IP literal, local name or private address).
      if (!this.allowedFileUrl(next) && !(this.allowedFileUrl(next, true) && (await this.publicHost(next)))) throw new Error('file download URL host not allowed');
      res = (await this.request(next, 'download file', '*/*', false, 'file'))!;
    }
    return { bytes: await this.readCapped(res, this.maxFileBytes), contentType: res.headers.get('content-type') };
  }
}

function pickArray(body: unknown, keys = ['Entries', 'entries', 'value', 'items', 'Items']): unknown[] {
  if (!body || typeof body !== 'object') return [];
  const o = body as Record<string, unknown>;
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[];
  return [];
}

const COUNT_KEYS = ['EntryCount', 'EntriesCount', 'entryCount', 'NumberOfEntries', 'Entries'];

/** Form list item -> CognitoFormInfo. Only the id, names and a count are kept; nothing else is read. */
export function formInfo(f: Record<string, unknown>): CognitoFormInfo {
  const rawId = f.Id ?? f.id;
  const id = typeof rawId === 'number' && Number.isInteger(rawId) ? rawId : typeof rawId === 'string' && /^\d{1,9}$/.test(rawId) ? Number(rawId) : null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);
  const count = COUNT_KEYS.map((k) => f[k]).find((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0);
  return { id, name: str(f.Name ?? f.name) ?? str(f.InternalName) ?? (id !== null ? `Form ${id}` : 'Unnamed form'), internalName: str(f.InternalName ?? f.internalName), entryCount: count ?? null };
}
