// HttpCognitoSource against a fake fetch: request shapes, paging, retries and where the API key is sent.
// Never calls the real Cognito API.
import { describe, expect, it } from 'vitest';
import { CognitoApiError, HttpCognitoSource } from '@/lib/import/cognito/api';
import type { CognitoEntry } from '@/lib/import/cognito/source';

type Call = { url: string; auth: string | undefined };

function fakeFetch(handler: (url: string) => Response) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
    return handler(url);
  }) as typeof fetch;
  return { f, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const FORM = { slug: 'release-form', cognitoFormId: 8, internalName: 'RELEASEFORM' };
const noSleep = async () => undefined;

async function collect(it: AsyncIterable<CognitoEntry>) {
  const out: CognitoEntry[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('HttpCognitoSource', () => {
  it('by-number: walks entry numbers, skips deleted ones, stops after consecutive misses', async () => {
    const present = new Set([1, 2, 4]);
    const { f, calls } = fakeFetch((url) => {
      const n = Number(url.split('/').pop());
      return present.has(n) ? json({ Id: `8-${n}`, Entry: { Number: n } }) : new Response('', { status: 404 });
    });
    const src = new HttpCognitoSource({ apiKey: 'test-key', fetch: f, sleep: noSleep, maxConsecutiveMisses: 3 });
    const got = await collect(src.listEntries(FORM, {}));
    expect(got.map((e) => e.Id)).toEqual(['8-1', '8-2', '8-4']);
    expect(calls[0]).toEqual({ url: 'https://www.cognitoforms.com/api/forms/8/entries/1', auth: 'Bearer test-key' });
    expect(calls).toHaveLength(7); // 1..4 then 5,6,7 missing
  });

  it('by-number honours maxNumber', async () => {
    const { f, calls } = fakeFetch((url) => json({ Id: url }));
    const src = new HttpCognitoSource({ apiKey: 'k', fetch: f, sleep: noSleep, maxNumber: 3 });
    expect(await collect(src.listEntries(FORM, {}))).toHaveLength(3);
    expect(calls).toHaveLength(3);
  });

  it('list mode pages until a short page and accepts a wrapped array', async () => {
    const { f, calls } = fakeFetch((url) => {
      const skip = Number(new URL(url).searchParams.get('skip'));
      return json({ Entries: skip === 0 ? [{ Id: '8-1' }, { Id: '8-2' }] : [{ Id: '8-3' }] });
    });
    const src = new HttpCognitoSource({ apiKey: 'k', fetch: f, sleep: noSleep, listMode: 'list', pageSize: 2 });
    expect((await collect(src.listEntries(FORM, {}))).map((e) => e.Id)).toEqual(['8-1', '8-2', '8-3']);
    expect(calls.map((c) => c.url)).toEqual([
      'https://www.cognitoforms.com/api/forms/8/entries?skip=0&take=2',
      'https://www.cognitoforms.com/api/forms/8/entries?skip=2&take=2',
    ]);
  });

  it('retries 429 and 5xx, then fails with the status only', async () => {
    let n = 0;
    const { f } = fakeFetch(() => (++n < 3 ? new Response('', { status: n === 1 ? 429 : 503, headers: { 'retry-after': '1' } }) : json({ Id: '8-1' })));
    const src = new HttpCognitoSource({ apiKey: 'k', fetch: f, sleep: noSleep, maxNumber: 1 });
    expect(await collect(src.listEntries(FORM, {}))).toHaveLength(1);

    const { f: denied } = fakeFetch(() => new Response('{"Name":"someone"}', { status: 401 }));
    const bad = new HttpCognitoSource({ apiKey: 'k', fetch: denied, sleep: noSleep, maxNumber: 1 });
    const err = await collect(bad.listEntries(FORM, {})).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoApiError);
    expect((err as Error).message).toMatch(/HTTP 401/);
    expect((err as Error).message).not.toContain('someone');
  });

  it('downloads: bearer key only to Cognito hosts; follows file metadata to the bytes; inline needs no request', async () => {
    const { f, calls } = fakeFetch((url) => {
      if (url.endsWith('/files/F-1')) return json({ Id: 'F-1', File: 'https://blob.example.invalid/abc' });
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), { headers: { 'content-type': 'application/pdf' } });
    });
    // The storage host resolves to a public address (a fake resolver: tests never use DNS).
    const src = new HttpCognitoSource({ apiKey: 'secret', fetch: f, sleep: noSleep, lookup: async () => ['93.184.216.34'] });
    const a = await src.downloadFile({ id: 'F-1', url: null, inline: null });
    expect(a.contentType).toBe('application/pdf');
    expect(a.bytes.length).toBe(5);
    expect(calls).toEqual([
      { url: 'https://www.cognitoforms.com/api/files/F-1', auth: 'Bearer secret' },
      { url: 'https://blob.example.invalid/abc', auth: undefined },
    ]);
    await src.downloadFile({ id: null, url: 'https://www.cognitoforms.com/file/F-2', inline: null });
    expect(calls[2]).toEqual({ url: 'https://www.cognitoforms.com/file/F-2', auth: 'Bearer secret' });
    const inline = await src.downloadFile({ id: null, url: null, inline: { base64: Buffer.from('hi').toString('base64'), contentType: 'image/svg+xml' } });
    expect(Buffer.from(inline.bytes).toString()).toBe('hi');
    expect(calls).toHaveLength(3);
  });

  it('file URLs from entry data must be https Cognito URLs; a bad JSON body never reaches the error text', async () => {
    const { f, calls } = fakeFetch(() => new Response('{"Name":"someone"', { headers: { 'content-type': 'application/json' } }));
    const src = new HttpCognitoSource({ apiKey: 'secret', fetch: f, sleep: noSleep, maxNumber: 1 });
    await expect(src.downloadFile({ id: null, url: 'http://www.cognitoforms.com/file/F-3', inline: null })).rejects.toThrow(/not an https Cognito URL/);
    await expect(src.downloadFile({ id: null, url: 'https://internal.example.invalid/x', inline: null })).rejects.toThrow(/not an https Cognito URL/);
    await expect(src.downloadFile({ id: null, url: null, inline: null })).rejects.toThrow(/has no source/);
    expect(calls).toHaveLength(0);
    const err = await collect(src.listEntries(FORM, {})).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoApiError);
    expect((err as Error).message).toMatch(/invalid JSON/);
    expect((err as Error).message).not.toContain('someone');
  });

  it('a file URL that is not an https Cognito URL falls back to the Id route and is never fetched', async () => {
    const { f, calls } = fakeFetch(() => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), { headers: { 'content-type': 'application/pdf' } }));
    const src = new HttpCognitoSource({ apiKey: 'secret', fetch: f, sleep: noSleep });
    for (const url of ['http://www.cognitoforms.com/file/F-4', 'https://internal.example.invalid/x']) {
      const got = await src.downloadFile({ id: 'F-4', url, inline: null });
      expect(got.bytes.length).toBe(5);
    }
    expect(calls).toEqual([
      { url: 'https://www.cognitoforms.com/api/files/F-4', auth: 'Bearer secret' },
      { url: 'https://www.cognitoforms.com/api/files/F-4', auth: 'Bearer secret' },
    ]);
  });

  it('refuses to start without a key', () => {
    expect(() => new HttpCognitoSource({ apiKey: '' })).toThrow('COGNITO_API_KEY');
  });
});
