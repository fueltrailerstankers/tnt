// M2 acceptance: no write calls to Xero exist anywhere. Xero stays the book of record and M2 is a read-only
// mirror. This test scans the source: any file that talks to the Xero API may only use GET. The single
// exception is the OAuth token endpoint on Xero's identity server (oauth.ts), which is not the accounting API.
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

const XERO_MARKERS = /api\.xro|api\.xero\.com|XERO_API_URL|XeroReader|integrations\/xero/;
const WRITE_METHOD = /method\s*:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/i;
const OAUTH = path.join(root, 'lib/integrations/xero/oauth.ts');

describe('no writes to Xero (M2)', () => {
  const source = [...files(path.join(root, 'lib')), ...files(path.join(root, 'app'))];

  it('finds the Xero integration files (the scan is not vacuous)', () => {
    expect(source.filter((f) => XERO_MARKERS.test(readFileSync(f, 'utf8'))).length).toBeGreaterThan(5);
  });

  it('every file that talks to Xero uses GET only', () => {
    const offenders = source
      .filter((f) => f !== OAUTH)
      .filter((f) => {
        const s = readFileSync(f, 'utf8');
        return XERO_MARKERS.test(s) && WRITE_METHOD.test(s);
      })
      .map((f) => path.relative(root, f));
    expect(offenders).toEqual([]);
  });

  it('the Xero API client exposes only a get method', () => {
    const client = readFileSync(path.join(root, 'lib/integrations/xero/client.ts'), 'utf8');
    expect(client).not.toMatch(WRITE_METHOD);
    const methods = [...client.matchAll(/^\s+async (\w+)/gm)].map((m) => m[1]);
    expect(methods).toEqual(['get', 'flushRate']);
  });

  it('the only POST in oauth.ts goes to the identity server token endpoint', () => {
    const s = readFileSync(OAUTH, 'utf8');
    expect(s.match(/method:\s*'POST'/g)).toHaveLength(1);
    expect(s).toMatch(/new URL\('\/connect\/token', c\.XERO_IDENTITY_URL\)/);
  });

  it('M2 asks Xero for read-only scopes', () => {
    const cfg = readFileSync(path.join(root, 'lib/integrations/xero/config.ts'), 'utf8');
    const scopes = cfg.match(/READ_SCOPES = '([^']+)'/)![1].split(' ');
    expect(scopes.filter((s) => s.startsWith('accounting.') && !s.endsWith('.read'))).toEqual([]);
  });
});
