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
import type {
  CognitoEntry, CognitoFileRef, CognitoFormInfo, CognitoFormRef, CognitoSource, DownloadedFile, ListOptions, PositionedEntry, SourcePosition,
} from './source';
import { decodeInline } from './source';

export const COGNITO_API_BASE = 'https://www.cognitoforms.com/api';

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

export class HttpCognitoSource implements CognitoSource {
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly o: HttpSourceOptions) {
    if (!o.apiKey) throw new Error('COGNITO_API_KEY is not set');
    this.base = (o.baseUrl ?? COGNITO_API_BASE).replace(/\/+$/, '');
    this.f = o.fetch ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
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

  private async request(url: string, what: string, accept = 'application/json', allow404 = false): Promise<Response | null> {
    const retries = this.o.retries ?? 5;
    for (let attempt = 0; ; attempt++) {
      const res = await this.f(url, { headers: this.headers(url, accept), redirect: 'follow' });
      if (res.ok) return res;
      if (res.status === 404 && allow404) return null;
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const ra = Number(res.headers.get('retry-after'));
        await this.sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) * 1000 : Math.min(2 ** attempt * 500, 30_000) + Math.random() * 250);
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new CognitoApiError(res.status, `${what} (check COGNITO_API_KEY and its scopes)`);
      throw new CognitoApiError(res.status, what);
    }
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
    let res = (await this.request(url, 'download file', '*/*'))!;
    // A6: the files endpoint may answer with metadata JSON that points at the bytes.
    if ((res.headers.get('content-type') ?? '').includes('application/json')) {
      const meta = (await this.json(res, 'download file')) as Record<string, unknown>;
      const next = [meta.File, meta.Url, meta.DownloadUrl, meta.url].find((v): v is string => typeof v === 'string' && /^https:\/\//.test(v));
      if (!next) throw new Error('file metadata without a download URL');
      if (!this.allowedFileUrl(next, true)) throw new Error('file download URL host not allowed');
      res = (await this.request(next, 'download file', '*/*'))!;
    }
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') };
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
