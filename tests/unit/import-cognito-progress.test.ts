// Pure helpers of the in-app import: stored report/cursor parsing, report merge, error codes and words, form
// matching for Test connection, the key's encryption, and the HTTP form list. Synthetic values only.
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { CognitoApiError, formInfo, HttpCognitoSource } from '@/lib/import/cognito/api';
import { orderForms } from '@/lib/import/cognito/importer';
import { last4, openApiKey, sealApiKey } from '@/lib/import/cognito/key';
import {
  errorCode, errorText, ImportJobError, lookupSources, matchForms, mergeFormReports, mergePlanned, parseCursor, parseOptions,
  parseReport, statusLabel, totalReport,
} from '@/lib/import/cognito/progress';
import { emptyFormReport, type FormReport } from '@/lib/import/cognito/report';
import { SLUGS, spec } from './specs';

function report(form: string, over: Partial<FormReport>): FormReport {
  return { ...emptyFormReport(form, null), ...over };
}

describe('stored run state', () => {
  it('parseReport round-trips a report and fills gaps from older rows; {} is "nothing yet"', () => {
    const r = report('deal', { seen: 5, skipped: { unknown_status: 1 }, files: { count: 2, bytes: 10, unknownSize: 1 }, maxNumber: 9 });
    expect(parseReport(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(parseReport({})).toBeNull();
    expect(parseReport(null)).toBeNull();
    const partial = parseReport({ form: 'deal', seen: 3, skipped: { x: 'bad' }, lookups: 'nope' })!;
    expect(partial).toMatchObject({ form: 'deal', seen: 3, toImport: 0, skipped: { x: 0 }, lookups: { resolved: 0, pendingSource: 0, unresolved: 0 } });
  });

  it('parseCursor keeps a valid position and Cognito entry ids only', () => {
    expect(parseCursor({ position: { kind: 'number', next: 12, misses: 3 }, planned: ['4-1', 'x', 7, '4-22', 'Fake Name'] }))
      .toEqual({ position: { kind: 'number', next: 12, misses: 3 }, planned: ['4-1', '4-22'] });
    expect(parseCursor({ position: { kind: 'number', next: 0, misses: 0 } }).position).toBeNull();
    expect(parseCursor({ position: { kind: 'other' } })).toEqual({ position: null, planned: [] });
    expect(parseCursor(undefined)).toEqual({ position: null, planned: [] });
    expect(parseCursor({ position: { kind: 'skip', n: 200 } }).position).toEqual({ kind: 'skip', n: 200 });
  });

  it('mergePlanned is a union in first-seen order', () => {
    expect(mergePlanned(['4-1', '4-2'], ['4-2', '4-3', 'bad'])).toEqual(['4-1', '4-2', '4-3']);
  });

  it('parseOptions accepts a positive limit only', () => {
    expect(parseOptions({ limit: 30 })).toEqual({ limit: 30 });
    expect(parseOptions({ limit: -1 })).toEqual({});
    expect(parseOptions(null)).toEqual({});
  });
});

describe('report merge', () => {
  const a = report('request-for-invoice', {
    expected: 1345, seen: 3, toImport: 2, imported: 1, skipped: { unknown_status: 1 }, failed: { download_failed: 1 },
    unknownFields: { OldNotes: { present: 1, withValue: 0 } }, issues: { 'DATE:invalid_date': 1 },
    files: { count: 3, bytes: 300, unknownSize: 0 }, stored: { files: 2, bytes: 200 }, lookups: { resolved: 1, pendingSource: 0, unresolved: 0 }, maxNumber: 3, counterSetTo: 3,
  });
  const b = report('delivery-note', {
    expected: 1095, seen: 4, toImport: 1, alreadyImported: 2, imported: 1, skipped: { unknown_status: 2, lookup_unresolved: 1 },
    unknownFields: { OldNotes: { present: 0, withValue: 2 } }, signatures: { count: 5, bytes: 50, unknownSize: 5 }, stoppedAtLimit: true, maxNumber: 10, counterSetTo: 10,
  });

  it('adds counts per reason and field, keeps the larger max number', () => {
    const t = mergeFormReports(a, b);
    expect(t).toMatchObject({
      form: 'all', expected: 2440, seen: 7, toImport: 3, alreadyImported: 2, imported: 2,
      skipped: { unknown_status: 3, lookup_unresolved: 1 }, failed: { download_failed: 1 },
      unknownFields: { OldNotes: { present: 1, withValue: 2 } }, issues: { 'DATE:invalid_date': 1 },
      files: { count: 3, bytes: 300, unknownSize: 0 }, signatures: { count: 5, bytes: 50, unknownSize: 5 }, stored: { files: 2, bytes: 200 },
      lookups: { resolved: 1, pendingSource: 0, unresolved: 0 }, stoppedAtLimit: true, maxNumber: 10, counterSetTo: null,
    });
    // Inputs are not changed.
    expect(a.skipped).toEqual({ unknown_status: 1 });
    expect(a.unknownFields.OldNotes).toEqual({ present: 1, withValue: 0 });
  });

  it('a later delta of the same form adds up and keeps the later counter', () => {
    const later = report('request-for-invoice', { seen: 2, imported: 2, counterSetTo: 5, maxNumber: 5 });
    expect(mergeFormReports(a, later)).toMatchObject({ form: 'request-for-invoice', expected: 1345, seen: 5, imported: 3, counterSetTo: 5, maxNumber: 5 });
  });

  it('totalReport over no forms is empty; over forms equals pairwise merges', () => {
    expect(totalReport([])).toEqual(emptyFormReport('all', null));
    expect(totalReport([a, b])).toEqual(mergeFormReports(mergeFormReports(emptyFormReport('all', null), a, 'all'), b, 'all'));
    expect(totalReport([a, b]).seen).toBe(7);
  });
});

describe('errors', () => {
  it('maps errors to reason codes, never to messages', () => {
    expect(errorCode(new CognitoApiError(401, 'list forms'))).toBe('cognito_auth');
    expect(errorCode(new CognitoApiError(403, 'x'))).toBe('cognito_auth');
    expect(errorCode(new CognitoApiError(404, 'x'))).toBe('cognito_not_found');
    expect(errorCode(new CognitoApiError(429, 'x'))).toBe('cognito_rate_limited');
    expect(errorCode(new CognitoApiError(503, 'x'))).toBe('cognito_http_503');
    expect(errorCode(new CognitoApiError(200, 'get entry: invalid JSON'))).toBe('cognito_bad_response');
    expect(errorCode(new TypeError('fetch failed'))).toBe('cognito_unreachable');
    expect(errorCode(new ImportJobError('no_api_key'))).toBe('no_api_key');
    expect(errorCode(new Error('duplicate key value (Testy Fakeperson)'))).toBe('internal_error');
    expect(errorCode('weird')).toBe('internal_error');
  });

  it('every code reads as plain words', () => {
    for (const c of ['no_api_key', 'cognito_auth', 'cognito_http_502', 'key_unreadable', 'something_new']) expect(errorText(c).length).toBeGreaterThan(10);
    expect(errorText('cognito_http_502')).toContain('502');
    expect(errorText(null)).toBe('');
  });
});

describe('test connection matching', () => {
  // In import order, as importableForms() returns them (RFI before Delivery Note).
  const platform = orderForms(SLUGS).map((s) => ({ slug: s, name: spec(s).name, cognitoFormId: spec(s).cognitoFormId, expected: spec(s).entryCountAtExport }));

  it('maps by Cognito form id, lists Cognito forms not in the platform, and platform forms Cognito did not list', () => {
    const cognito = [
      formInfo({ Id: '99', Name: 'Synthetic Survey', InternalName: 'SyntheticSurvey' }),
      formInfo({ Id: 4, Name: 'Request For Invoice', InternalName: 'RequestForInvoice', EntryCount: 1345 }),
      formInfo({ Id: '5', Name: 'Delivery Note', InternalName: 'DeliveryNoteTermsAndConditions' }),
    ];
    const { forms, missing } = matchForms(cognito, platform);
    expect(forms.map((f) => [f.cognito.name, f.platform?.slug ?? null])).toEqual([
      ['Request For Invoice', 'request-for-invoice'], ['Delivery Note', 'delivery-note'], ['Synthetic Survey', null],
    ]);
    expect(forms[0].cognito.entryCount).toBe(1345);
    expect(forms[1].cognito.entryCount).toBeNull();
    expect(missing.map((m) => m.slug).sort()).toEqual(SLUGS.filter((s) => !['request-for-invoice', 'delivery-note'].includes(s)).sort());
  });

  it('formInfo keeps only id, names and a numeric count', () => {
    expect(formInfo({ Id: 'abc', Name: '  ', InternalName: 'X', Entries: [1, 2] })).toEqual({ id: null, name: 'X', internalName: 'X', entryCount: null });
    expect(formInfo({ id: 12, name: 'Store Room', Entries: 8, Secret: 'x' })).toEqual({ id: 12, name: 'Store Room', internalName: null, entryCount: 8 });
    expect(formInfo({}).name).toBe('Unnamed form');
  });

  it('lookup sources come from the specs (RFI is looked up by the Delivery Note)', () => {
    expect([...lookupSources(SLUGS.map(spec))]).toEqual(['request-for-invoice']);
  });

  it('status words', () => {
    expect(statusLabel('running', true, false)).toBe('Running');
    expect(statusLabel('running', false, false)).toBe('Waiting for the next job run');
    expect(statusLabel('running', true, true)).toBe('Stopping');
    expect(statusLabel('paused', false, false)).toBe('Paused');
  });
});

describe('API key at rest', () => {
  const ORG = '00000000-0000-0000-0000-000000000001';
  const key = randomBytes(32);

  it('is AES-256-GCM sealed, bound to the org, and opens with the same key only', () => {
    const sealed = sealApiKey('synthetic-cognito-key-1234', ORG, key);
    expect(sealed).toMatch(/^\\x[0-9a-f]+$/);
    expect(sealed).not.toContain(Buffer.from('synthetic').toString('hex'));
    expect(openApiKey(sealed, ORG, key)).toBe('synthetic-cognito-key-1234');
    expect(() => openApiKey(sealed, '00000000-0000-0000-0000-000000000002', key)).toThrow();
    expect(() => openApiKey(sealed, ORG, randomBytes(32))).toThrow();
    expect(sealApiKey('synthetic-cognito-key-1234', ORG, key)).not.toBe(sealed); // fresh IV each time
    expect(last4('synthetic-cognito-key-1234')).toBe('1234');
  });
});

describe('HttpCognitoSource form list and entry probe', () => {
  const calls: Array<{ url: string; auth?: string }> = [];
  const source = (status: (url: string) => number, body: unknown = []) => new HttpCognitoSource({
    apiKey: 'synthetic-key', retries: 0, sleep: async () => undefined,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization });
      return new Response(JSON.stringify(body), { status: status(url), headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });
  const FORM = { slug: 'release-form', cognitoFormId: 8, internalName: 'RELEASEFORM' };

  it('GET /forms with the bearer key; accepts a bare or wrapped array', async () => {
    calls.length = 0;
    expect(await source(() => 200, [{ Id: '8', Name: 'Release Form' }]).listForms()).toEqual([{ id: 8, name: 'Release Form', internalName: null, entryCount: null }]);
    expect(calls).toEqual([{ url: 'https://www.cognitoforms.com/api/forms', auth: 'Bearer synthetic-key' }]);
    expect(await source(() => 200, { Forms: [{ Id: 9, Name: 'DEAL' }] }).listForms()).toHaveLength(1);
    await expect(source(() => 401).listForms()).rejects.toMatchObject({ status: 401 });
  });

  it('probeEntries: entry or 404 is ok, 401/403 is denied, other errors throw', async () => {
    expect(await source(() => 200, { Id: '8-1' }).probeEntries(FORM)).toBe('ok');
    expect(await source(() => 404).probeEntries(FORM)).toBe('ok');
    expect(await source(() => 403).probeEntries(FORM)).toBe('denied');
    await expect(source(() => 500).probeEntries(FORM)).rejects.toBeInstanceOf(CognitoApiError);
  });
});
