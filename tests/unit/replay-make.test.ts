// The Make parity harness on the synthetic example recordings (tests/fixtures/make/example.json).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffValues, parseReplayFile, pathMatches, replay } from '@/lib/integrations/xero/write/replay';

const root = path.resolve(__dirname, '../..');
const FIXTURE = path.join(root, 'tests/fixtures/make/example.json');
const file = parseReplayFile(JSON.parse(readFileSync(FIXTURE, 'utf8')));

describe('replay-make harness', () => {
  const r = replay(file);
  const byId = Object.fromEntries(r.reports.map((x) => [x.id, x]));

  it('matches Make on the four faithful executions', () => {
    for (const id of ['synthetic-deal-1', 'synthetic-rfi-1', 'synthetic-delivery-1', 'synthetic-release-1']) {
      expect(byId[id].lines, id).toEqual([]);
      expect(byId[id].match).toBe(true);
    }
    expect(r.matched).toBe(4);
  });

  it('reports every difference on the divergent one, with personal data redacted', () => {
    const d = byId['synthetic-rfi-2-divergent'];
    expect(d.match).toBe(false);
    expect(d.lines).toEqual([
      '  ~ PUT /Invoices Invoices.0.Status: platform "DRAFT" / make "AUTHORISED"',
      '  - only in Make: PUT /Invoices/33333333-0000-4000-8000-000000000002/Attachments/[file]',
    ]);
    expect(r.differing).toBe(1);
    expect(r.text).not.toMatch(/example\.invalid|Test Buyer|deposit-1/);
    expect(r.text).toContain('4 of 5 executions match Make.');
  });

  it('diff helpers: placeholders match any id; numbers match numeric strings', () => {
    expect(pathMatches('/Invoices/{{invoice}}/Attachments/a%20b.pdf', '/Invoices/abc/Attachments/a b.pdf')).toBe(true);
    expect(pathMatches('/Invoices/{{invoice}}', '/Invoices/abc/History')).toBe(false);
    expect(diffValues({ a: '{{x}}', n: 5 }, { a: 'id-1', n: '5' })).toEqual([]);
    expect(diffValues({ a: 1 }, { a: 1, b: 2 })).toEqual([{ path: 'b', ours: undefined, theirs: 2 }]);
  });

  it('rejects files in another format', () => {
    expect(() => parseReplayFile({ format: 'x', executions: [] })).toThrow(/tt-make-replay/);
  });

  it('the CLI prints the diff and exits 1 when anything differs', () => {
    let out = '';
    let code = 0;
    try {
      out = execFileSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'scripts/replay-make.ts'), FIXTURE], { cwd: root, encoding: 'utf8' });
    } catch (e) {
      const err = e as { status: number; stdout: string };
      code = err.status;
      out = err.stdout;
    }
    expect(code).toBe(1);
    expect(out).toContain('MATCH synthetic-rfi-1 [rfi.create_invoice]');
    expect(out).toContain('DIFF  synthetic-rfi-2-divergent');
  }, 30_000);
});
