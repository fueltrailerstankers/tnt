// Security review fixes for the Cognito source and importer: step deadline on every request and retry wait (M1),
// file size caps (M1), manual redirects and private targets on the storage hop (L4), the API base override (L3).
// Fake fetch and fake DNS only; never the network.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { sealData } from '@/lib/forms/entries';
import { CognitoApiError, cognitoApiBase, HttpCognitoSource, privateAddress } from '@/lib/import/cognito/api';
import { runImportSlice } from '@/lib/import/cognito/importer';
import { errorCode, MAX_POSITION_ATTEMPTS, MAX_WAIT_ATTEMPTS, nextAttempt, parseCursor, retryWaitMs } from '@/lib/import/cognito/progress';
import { FileTooLargeError, SourceDeadlineError, type CognitoEntry, type CognitoFileRef, type CognitoSource, type DownloadedFile } from '@/lib/import/cognito/source';
import { MAX_FILE_BYTES } from '@/lib/spec/values';
import { FakeSource, allFixtures, platform } from './cognito-fake';

type Call = { url: string; auth?: string; signal?: AbortSignal; redirect?: RequestRedirect };

function fake(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, auth: (init.headers as Record<string, string> | undefined)?.Authorization, signal: init.signal ?? undefined, redirect: init.redirect });
    return handler(url, init);
  }) as typeof fetch;
  return { f, calls };
}

const PUBLIC_DNS = async () => ['93.184.216.34'];
const bytes = (n: number) => new Uint8Array(n).fill(0x25);

/** A body stream of `chunks` chunks of `size` bytes that records how far it was read and whether it was cancelled. */
function trackedStream(chunks: number, size: number) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (state.pulled >= chunks) return c.close();
      state.pulled++;
      c.enqueue(bytes(size));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

describe('M1: file size caps', () => {
  it('a declared Content-Length above the cap is refused without reading the body', async () => {
    const { stream, state } = trackedStream(100, 1024);
    const { f } = fake(() => new Response(stream, { headers: { 'content-type': 'application/pdf', 'content-length': String(300 * 1024 * 1024) } }));
    const src = new HttpCognitoSource({ apiKey: 'k', fetch: f, sleep: async () => undefined });
    await expect(src.downloadFile({ id: 'F-1', url: null, inline: null })).rejects.toBeInstanceOf(FileTooLargeError);
    expect(state.pulled).toBeLessThanOrEqual(1); // never drained
  });

  it('a body longer than the cap (no Content-Length) is cut off and cancelled', async () => {
    const { stream, state } = trackedStream(1000, 1024);
    const { f } = fake(() => new Response(stream, { headers: { 'content-type': 'application/pdf' } }));
    const src = new HttpCognitoSource({ apiKey: 'k', fetch: f, maxFileBytes: 10 * 1024 });
    await expect(src.downloadFile({ id: 'F-1', url: null, inline: null })).rejects.toBeInstanceOf(FileTooLargeError);
    expect(state.pulled).toBeLessThan(20);
    expect(state.cancelled).toBe(true);
  });

  it('a body within the cap is read in full; the default cap is MAX_FILE_BYTES', async () => {
    const { stream } = trackedStream(3, 1024);
    const { f } = fake(() => new Response(stream, { headers: { 'content-type': 'application/pdf' } }));
    const got = await new HttpCognitoSource({ apiKey: 'k', fetch: f }).downloadFile({ id: 'F-1', url: null, inline: null });
    expect(got.bytes.length).toBe(3072);
    const { f: big } = fake(() => new Response(null, { headers: { 'content-length': String(MAX_FILE_BYTES + 1) } }));
    await expect(new HttpCognitoSource({ apiKey: 'k', fetch: big }).downloadFile({ id: 'F-1', url: null, inline: null })).rejects.toBeInstanceOf(FileTooLargeError);
  });

  it('the importer fails an entry whose declared file size is too big without downloading anything or writing it', async () => {
    const fixtures = allFixtures();
    const rfi = structuredClone(fixtures['request-for-invoice']);
    (rfi[0]._1stDeposit as Array<Record<string, unknown>>)[0].Size = MAX_FILE_BYTES + 1;
    const source = new FakeSource({ 'request-for-invoice': rfi });
    const sink = platform();
    const r = await runImportSlice({ source, sink, seal: sealData }, { form: 'request-for-invoice', apply: true });
    expect(r.report.failed).toEqual({ file_too_large: 1 });
    expect(source.downloads.filter((d) => d.includes('rfi1'))).toEqual([]);
    expect(sink.entries.map((e) => e.cognito_entry_id)).toEqual(['4-2']);
  });

  it('a source that finds a file too large while downloading gives file_too_large, not download_failed', async () => {
    const source = new FakeSource({ 'request-for-invoice': allFixtures()['request-for-invoice'] });
    source.downloadFile = async () => { throw new FileTooLargeError(); };
    const r = await runImportSlice({ source, sink: platform(), seal: sealData }, { form: 'request-for-invoice', apply: true });
    expect(r.report.failed).toEqual({ file_too_large: 2 });
  });
});

describe('M1: step deadline', () => {
  it('every request carries an AbortSignal and manual redirects when a deadline is set; the CLI (no deadline) has no signal', async () => {
    const { f, calls } = fake(() => new Response('[]', { headers: { 'content-type': 'application/json' } }));
    await new HttpCognitoSource({ apiKey: 'k', fetch: f, deadline: Date.now() + 10_000 }).listForms();
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].redirect).toBe('manual');
    await new HttpCognitoSource({ apiKey: 'k', fetch: f }).listForms();
    expect(calls[1].signal).toBeUndefined();
  });

  it('a passed deadline throws step_deadline before any request', async () => {
    const { f, calls } = fake(() => new Response('[]'));
    await expect(new HttpCognitoSource({ apiKey: 'k', fetch: f, deadline: Date.now() - 1 }).listForms()).rejects.toMatchObject({ code: 'step_deadline' });
    expect(calls).toHaveLength(0);
  });

  it('a request that hangs is aborted at the deadline (step_deadline), it does not wait for the platform time limit', async () => {
    const { f } = fake((_url, init) => new Promise<Response>((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('timed out', 'TimeoutError')));
    }));
    const t0 = Date.now();
    const err = await new HttpCognitoSource({ apiKey: 'k', fetch: f, deadline: Date.now() + 80 }).listForms().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceDeadlineError);
    expect((err as SourceDeadlineError).code).toBe('step_deadline');
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('a Retry-After longer than the time left throws cognito_rate_limited instead of sleeping; 5xx gives cognito_unavailable', async () => {
    const sleep = vi.fn(async () => undefined);
    const { f: limited } = fake(() => new Response('{}', { status: 429, headers: { 'retry-after': '60' } }));
    const err = await new HttpCognitoSource({ apiKey: 'k', fetch: limited, sleep, deadline: Date.now() + 10_000 }).listForms().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'cognito_rate_limited', retryAfterMs: 60_000 });
    expect(errorCode(err)).toBe('cognito_rate_limited');
    const { f: down } = fake(() => new Response('{}', { status: 503, headers: { 'retry-after': '30' } }));
    await expect(new HttpCognitoSource({ apiKey: 'k', fetch: down, sleep, deadline: Date.now() + 5_000 }).listForms()).rejects.toMatchObject({ code: 'cognito_unavailable' });
    expect(sleep).not.toHaveBeenCalled();
    // A short wait that fits is still slept (and the CLI, without a deadline, keeps its retries).
    let n = 0;
    const { f: once } = fake(() => (n++ ? new Response('[]', { headers: { 'content-type': 'application/json' } }) : new Response('{}', { status: 429, headers: { 'retry-after': '1' } })));
    await new HttpCognitoSource({ apiKey: 'k', fetch: once, sleep, deadline: Date.now() + 10_000 }).listForms();
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('a step deadline during a download aborts the step: the entry is neither failed nor passed, no checkpoint covers it', async () => {
    class Slow extends FakeSource {
      async downloadFile(ref: CognitoFileRef): Promise<DownloadedFile> {
        if ((ref.url ?? '').includes('rfi1')) throw new SourceDeadlineError('step_deadline');
        return super.downloadFile(ref);
      }
    }
    const source: CognitoSource = new Slow({ 'request-for-invoice': allFixtures()['request-for-invoice'] });
    const sink = platform();
    const positions: unknown[] = [];
    const err = await runImportSlice({ source, sink, seal: sealData }, {
      form: 'request-for-invoice', apply: true, concurrency: 1, checkpointEvery: 1, deadline: Date.now() + 60_000,
      checkpoint: async (p) => { positions.push(p); },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceDeadlineError);
    expect(positions).toEqual([]);
    expect(sink.refs).toEqual([]); // the entry has no commit marker: the next step finishes it
  });
});

describe('M1: attempts per position', () => {
  it('counts steps that start at the same position and gives up after the limit with the last retry reason', () => {
    let c = parseCursor({ position: { kind: 'number', next: 7, misses: 0 } });
    for (let i = 1; i <= MAX_POSITION_ATTEMPTS; i++) {
      const r = nextAttempt(c);
      expect(r).toMatchObject({ attempt: { n: i }, giveUp: null });
      c = parseCursor(JSON.parse(JSON.stringify({ ...c, attempt: r.attempt })));
    }
    expect(nextAttempt(c).giveUp).toBe('stuck_entry');
    // Cognito asking to wait gets more attempts before the run gives up with that reason.
    expect(nextAttempt({ ...c, attempt: { ...c.attempt!, last: 'cognito_rate_limited' } }).giveUp).toBeNull();
    expect(nextAttempt({ ...c, attempt: { ...c.attempt!, n: MAX_WAIT_ATTEMPTS, last: 'cognito_rate_limited' } }).giveUp).toBe('cognito_rate_limited');
    // Progress (another position) starts the count again.
    expect(nextAttempt({ ...c, position: { kind: 'number', next: 8, misses: 0 } })).toMatchObject({ attempt: { n: 1 }, giveUp: null });
  });

  it('retryWaitMs honours Retry-After, doubles per attempt and stays within bounds', () => {
    expect(retryWaitMs(0, 1)).toBe(30_000);
    expect(retryWaitMs(0, 2)).toBe(60_000);
    expect(retryWaitMs(0, 4)).toBe(240_000);
    expect(retryWaitMs(0, 12)).toBe(600_000);
    expect(retryWaitMs(90_000, 1)).toBe(90_000);
    expect(retryWaitMs(5_000, 1)).toBe(30_000);
    expect(retryWaitMs(3_600_000, 1)).toBe(600_000);
  });

  it('parseCursor keeps a well-formed attempt record only', () => {
    expect(parseCursor({ attempt: { at: 'null', n: 2, last: 'cognito_rate_limited' } }).attempt).toEqual({ at: 'null', n: 2, last: 'cognito_rate_limited' });
    expect(parseCursor({ attempt: { at: 'null', n: 0 } }).attempt).toBeUndefined();
    expect(parseCursor({ attempt: { at: 'null', n: 1, last: 'Bad Message!' } }).attempt).toEqual({ at: 'null', n: 1 });
  });
});

describe('L4: redirects and the storage hop', () => {
  const PDF = () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), { headers: { 'content-type': 'application/pdf' } });
  const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

  it('an API redirect may only stay on Cognito; the key goes to Cognito hosts only', async () => {
    const { f, calls } = fake((url) => (url.endsWith('/api/forms') ? redirect('https://api2.cognitoforms.com/forms') : new Response('[]', { headers: { 'content-type': 'application/json' } })));
    await new HttpCognitoSource({ apiKey: 'secret', fetch: f }).listForms();
    expect(calls.map((c) => [c.url, c.auth])).toEqual([
      ['https://www.cognitoforms.com/api/forms', 'Bearer secret'],
      ['https://api2.cognitoforms.com/forms', 'Bearer secret'],
    ]);
    const { f: evil, calls: evilCalls } = fake(() => redirect('https://attacker.example.invalid/steal'));
    const err = await new HttpCognitoSource({ apiKey: 'secret', fetch: evil, lookup: PUBLIC_DNS }).listForms().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoApiError);
    expect(evilCalls).toHaveLength(1);
  });

  it('a file download may be redirected to a public https storage host, without the key; never to private, plain http or past 3 hops', async () => {
    const { f, calls } = fake((url) => (url.includes('/api/files/') ? redirect('https://blob.example.invalid/x') : PDF()));
    const got = await new HttpCognitoSource({ apiKey: 'secret', fetch: f, lookup: PUBLIC_DNS }).downloadFile({ id: 'F-1', url: null, inline: null });
    expect(got.bytes.length).toBe(5);
    expect(calls[1]).toMatchObject({ url: 'https://blob.example.invalid/x', auth: undefined });

    for (const [target, dns] of [
      ['http://blob.example.invalid/x', PUBLIC_DNS],
      ['https://169.254.169.254/latest/meta-data', PUBLIC_DNS],
      ['https://metadata.internal/x', PUBLIC_DNS],
      ['https://rebind.example.invalid/x', async () => ['10.0.0.5']],
      ['https://mixed.example.invalid/x', async () => ['93.184.216.34', '127.0.0.1']],
      ['https://nodns.example.invalid/x', async () => { throw new Error('ENOTFOUND'); }],
    ] as const) {
      const { f: g, calls: c } = fake((url) => (url.includes('/api/files/') ? redirect(target) : PDF()));
      await expect(new HttpCognitoSource({ apiKey: 'secret', fetch: g, lookup: dns }).downloadFile({ id: 'F-1', url: null, inline: null })).rejects.toThrow();
      expect(c).toHaveLength(1);
    }

    let hops = 0;
    const { f: loop, calls: loopCalls } = fake(() => redirect(`https://www.cognitoforms.com/api/files/F-${++hops}`));
    await expect(new HttpCognitoSource({ apiKey: 'k', fetch: loop }).downloadFile({ id: 'F-0', url: null, inline: null })).rejects.toThrow(/too many redirects/);
    expect(loopCalls).toHaveLength(4);
  });

  it('the metadata hop refuses IP literals, local names and hosts that resolve to private addresses', async () => {
    for (const [next, dns, ok] of [
      ['https://127.0.0.1/x', PUBLIC_DNS, false],
      ['https://[::1]/x', PUBLIC_DNS, false],
      ['https://localhost/x', PUBLIC_DNS, false],
      ['https://10.1.2.3/x', PUBLIC_DNS, false],
      ['https://store.example.invalid/x', async () => ['169.254.169.254'], false],
      ['https://store.example.invalid/x', async () => ['fd00::1'], false],
      ['https://store.example.invalid/x', PUBLIC_DNS, true],
    ] as const) {
      const { f, calls } = fake((url) => (url.includes('/api/files/') ? new Response(JSON.stringify({ File: next }), { headers: { 'content-type': 'application/json' } }) : PDF()));
      const p = new HttpCognitoSource({ apiKey: 'k', fetch: f, lookup: dns }).downloadFile({ id: 'F-1', url: null, inline: null });
      if (ok) {
        expect((await p).bytes.length).toBe(5);
        expect(calls[1].auth).toBeUndefined();
      } else {
        await expect(p).rejects.toThrow(/host not allowed/);
        expect(calls).toHaveLength(1);
      }
    }
  });

  it('privateAddress', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', 'not-an-ip']) {
      expect(privateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) expect(privateAddress(ip), ip).toBe(false);
  });
});

describe('L3: COGNITO_API_URL override', () => {
  it('accepts https cognitoforms.com, and loopback http outside production only; anything else falls back to the default', () => {
    const def = 'https://www.cognitoforms.com/api';
    expect(cognitoApiBase(undefined, true)).toEqual({ base: def, ignored: false });
    expect(cognitoApiBase('  ', true)).toEqual({ base: def, ignored: false });
    expect(cognitoApiBase('https://eu.cognitoforms.com/api/', true)).toEqual({ base: 'https://eu.cognitoforms.com/api', ignored: false });
    expect(cognitoApiBase('http://127.0.0.1:54598/api', false)).toEqual({ base: 'http://127.0.0.1:54598/api', ignored: false });
    for (const bad of ['http://127.0.0.1:54598/api', 'https://attacker.example.invalid/api', 'http://www.cognitoforms.com/api',
      'https://cognitoforms.com.attacker.invalid/api', 'https://user:pw@www.cognitoforms.com/api', 'not a url', 'https://www.cognitoforms.com/api?x=1']) {
      expect(cognitoApiBase(bad, true), bad).toEqual({ base: def, ignored: true });
    }
    expect(cognitoApiBase('https://attacker.example.invalid/api', false).ignored).toBe(true);
  });
});

// Entries are typed loosely in fixtures; keep the import used.
void (null as unknown as CognitoEntry);
let saved: string | undefined;
beforeAll(() => {
  saved = process.env.ENTRY_ENCRYPTION_KEY;
  process.env.ENTRY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});
afterAll(() => {
  process.env.ENTRY_ENCRYPTION_KEY = saved;
});
