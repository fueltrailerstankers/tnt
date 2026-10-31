// The 7 kit forms must parse, render, read, validate, display, export and print exactly as they did
// before M8 added field types and options. See tests/unit/kit-snapshot.ts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { kitSnapshot } from './kit-snapshot';
import { SLUGS, spec } from './specs';

const file = path.resolve(__dirname, '../fixtures/kit-forms/baseline.json');
const WRITE = process.env.KIT_BASELINE === 'write';

describe('kit forms are unchanged by the M8 engine', () => {
  it.runIf(WRITE)('writes the baseline', async () => {
    const out: Record<string, unknown> = {};
    for (const s of SLUGS) out[s] = await kitSnapshot(spec(s));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
  }, 60_000);

  it.skipIf(WRITE).each(['deal', 'delivery-note', 'job-card', 'release-form', 'request-for-invoice', 'store-room', 'trailer-inspection-checklist'])(
    '%s',
    async (slug) => {
      const baseline = JSON.parse(readFileSync(file, 'utf8'))[slug];
      expect(baseline).toBeDefined();
      expect(JSON.parse(JSON.stringify(await kitSnapshot(spec(slug))))).toEqual(baseline);
    },
    60_000,
  );
});
