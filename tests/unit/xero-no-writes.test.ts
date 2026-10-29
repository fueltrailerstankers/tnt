// Xero stays the book of record. M2 was a read-only mirror; M3 adds writes, but ONLY through
// lib/integrations/xero/write/writer.ts (claimed, idempotent, dry-run by default). This test scans the source:
//   - no file except writer.ts and oauth.ts (the identity server token endpoint) uses a non-GET method literal
//     next to Xero code
//   - only client.ts (GET), oauth.ts and writer.ts call fetch() in Xero code
//   - planners never call fetch; they produce data (PlannedRequest) for the writer
//   - writer.ts has no DELETE/PATCH and checks its claim before any network call
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' || n.startsWith('.') ? [] : files(p);
    return /\.(ts|tsx|mjs|js)$/.test(n) ? [p] : [];
  });
}

const XERO_MARKERS = /api\.xro|api\.xero\.com|XERO_API_URL|XeroReader|XeroWriter|integrations\/xero|from '\.\.?\/(writer|client|config|connection)'/;
const WRITE_METHOD = /method\s*:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/i;
const OAUTH = path.join(root, 'lib/integrations/xero/oauth.ts');
const WRITER = path.join(root, 'lib/integrations/xero/write/writer.ts');
const CLIENT = path.join(root, 'lib/integrations/xero/client.ts');

describe('Xero writes only through the writer (M3)', () => {
  const source = [...files(path.join(root, 'lib')), ...files(path.join(root, 'app')), ...files(path.join(root, 'scripts'))];
  const xero = source.filter((f) => XERO_MARKERS.test(readFileSync(f, 'utf8')));

  it('finds the Xero integration files (the scan is not vacuous)', () => {
    expect(xero.length).toBeGreaterThan(10);
    expect(xero).toContain(WRITER);
  });

  it('no file except writer.ts and oauth.ts uses a non-GET method with Xero', () => {
    const offenders = xero.filter((f) => f !== OAUTH && f !== WRITER && WRITE_METHOD.test(readFileSync(f, 'utf8'))).map((f) => path.relative(root, f));
    expect(offenders).toEqual([]);
  });

  it('only client.ts, oauth.ts and writer.ts call fetch() in Xero code', () => {
    const fetchers = xero.filter((f) => /\bfetch\s*\(|fetchImpl\s*\(/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(root, f)).sort();
    expect(fetchers).toEqual(['lib/integrations/xero/client.ts', 'lib/integrations/xero/oauth.ts', 'lib/integrations/xero/write/writer.ts']);
  });

  it('the read client still exposes only GET', () => {
    const client = readFileSync(CLIENT, 'utf8');
    expect(client).not.toMatch(WRITE_METHOD);
    const methods = [...client.matchAll(/^\s+async (\w+)/gm)].map((m) => m[1]);
    expect(methods).toEqual(['get', 'flushRate']);
  });

  it('the writer allows POST and PUT only, and checks claim and mode before fetch', () => {
    const w = readFileSync(WRITER, 'utf8');
    expect(w).toMatch(/new Set<WriteMethod>\(\['POST', 'PUT'\]\)/);
    expect(w).not.toMatch(/['"`](DELETE|PATCH)['"`]/);
    const send = w.slice(w.indexOf('async send('), w.indexOf('async download('));
    const fetchAt = send.indexOf('fetchImpl(url');
    expect(send.indexOf("this.deps.mode === 'dry_run'")).toBeGreaterThan(-1);
    expect(send.indexOf("this.deps.mode === 'dry_run'")).toBeLessThan(fetchAt);
    expect(send.indexOf('live send without a claimed key')).toBeLessThan(fetchAt);
    expect(send.indexOf('claim does not match the request')).toBeLessThan(fetchAt);
    // The only other request in the writer is a GET download.
    const download = w.slice(w.indexOf('async download('));
    expect(download).toMatch(/method: 'GET'/);
  });

  it('the only POST in oauth.ts goes to the identity server token endpoint', () => {
    const s = readFileSync(OAUTH, 'utf8');
    expect(s.match(/method:\s*'POST'/g)).toHaveLength(1);
    expect(s).toMatch(/new URL\('\/connect\/token', c\.XERO_IDENTITY_URL\)/);
  });

  it('the default scopes stay read-only; write scopes are opt-in', () => {
    const cfg = readFileSync(path.join(root, 'lib/integrations/xero/config.ts'), 'utf8');
    const scopes = cfg.match(/READ_SCOPES = '([^']+)'/)![1].split(' ');
    expect(scopes.filter((s) => s.startsWith('accounting.') && !s.endsWith('.read'))).toEqual([]);
    expect(cfg).toMatch(/\.default\(READ_SCOPES\)/);
  });

  it('every action defaults to off', () => {
    const modes = readFileSync(path.join(root, 'lib/integrations/xero/write/modes.ts'), 'utf8');
    expect(modes).toMatch(/: 'off';\n}/);
  });
});
