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
import type { CognitoEntry, CognitoFileRef, CognitoFormRef, CognitoSource, DownloadedFile, ListOptions } from './source';
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
    void opts; // since is applied by the importer; no server-side filter is assumed
    if ((this.o.listMode ?? 'by-number') === 'list') {
      yield* this.listPaged(form);
      return;
    }
    const maxMisses = this.o.maxConsecutiveMisses ?? 200;
    let misses = 0;
    for (let n = 1; this.o.maxNumber === undefined || n <= this.o.maxNumber; n++) {
      const res = await this.request(`${this.base}/forms/${form.cognitoFormId}/entries/${n}`, `get entry (form ${form.slug})`, 'application/json', true);
      if (!res) {
        if (++misses >= maxMisses) return;
        continue;
      }
      misses = 0;
      const body = await this.json(res, `get entry (form ${form.slug})`);
      if (body && typeof body === 'object' && !Array.isArray(body)) yield body as CognitoEntry;
    }
  }

  private async *listPaged(form: CognitoFormRef): AsyncIterable<CognitoEntry> {
    const take = this.o.pageSize ?? 100;
    for (let skip = 0; ; skip += take) {
      const res = await this.request(`${this.base}/forms/${form.cognitoFormId}/entries?skip=${skip}&take=${take}`, `list entries (form ${form.slug})`);
      const body = await this.json(res!, `list entries (form ${form.slug})`);
      const page = Array.isArray(body) ? body : pickArray(body);
      for (const e of page) if (e && typeof e === 'object') yield e as CognitoEntry;
      if (page.length < take) return;
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

function pickArray(body: unknown): unknown[] {
  if (!body || typeof body !== 'object') return [];
  const o = body as Record<string, unknown>;
  for (const k of ['Entries', 'entries', 'value', 'items', 'Items']) if (Array.isArray(o[k])) return o[k] as unknown[];
  return [];
}
