// Test helpers for the Cognito importer: fixtures, an in-memory CognitoSource and platform forms built from the
// kit specs. Never touches the network.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CognitoEntry, CognitoFileRef, CognitoFormRef, CognitoSource, DownloadedFile } from '@/lib/import/cognito/source';
import { MemorySink, formRecordFromSpec } from '@/lib/import/cognito/memory-sink';
import { SLUGS, spec } from './specs';

const FIXTURES = path.resolve(__dirname, '../fixtures/cognito');
export const ORG = '00000000-0000-0000-0000-0000000000aa';

export function fixture(slug: string): CognitoEntry[] {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${slug}.json`), 'utf8')) as CognitoEntry[];
}

export function entryOf(slug: string, id: string): CognitoEntry {
  const e = fixture(slug).find((x) => x.Id === id);
  if (!e) throw new Error(`no fixture ${slug} ${id}`);
  return e;
}

/** Every made-up personal value in the fixtures; none may appear in a report. */
export const PERSONAL = [
  'Testy', 'Fakeperson', 'Sample', 'Nobody', 'Inspecta', 'Fakeinspector', 'FAKE-ID-', 'FAKE-VAT', '000 000 0001',
  'example.invalid', 'Example Street', 'Testville', 'FAKEVIN', 'Fake Customer', 'Fake Rep', 'fake-', '.pdf', '.jpg', 'Synthetic',
];

const MAGIC: Record<string, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

function bytesFor(contentType: string, size: number): Uint8Array {
  const b = new Uint8Array(Math.max(size, 16));
  b.set(MAGIC[contentType] ?? []);
  return b;
}

export class FakeSource implements CognitoSource {
  downloads: string[] = [];
  failIds = new Set<string>();
  private catalogue = new Map<string, { contentType: string; size: number }>();

  constructor(private readonly entries: Record<string, CognitoEntry[]>) {
    for (const list of Object.values(entries)) {
      for (const e of list) {
        for (const v of Object.values(e)) {
          for (const item of Array.isArray(v) ? v : [v]) {
            const o = item as Record<string, unknown> | null;
            if (o && typeof o === 'object' && typeof o.File === 'string') {
              this.catalogue.set(o.File, { contentType: String(o.ContentType), size: Number(o.Size) });
            }
          }
        }
      }
    }
  }

  async *listEntries(form: CognitoFormRef): AsyncIterable<CognitoEntry> {
    for (const e of this.entries[form.slug] ?? []) yield structuredClone(e);
  }

  async downloadFile(ref: CognitoFileRef): Promise<DownloadedFile> {
    const key = ref.url ?? ref.id ?? '';
    this.downloads.push(key);
    if ((ref.id && this.failIds.has(ref.id)) || [...this.failIds].some((id) => key.endsWith(id))) throw new Error('simulated download failure');
    const known = this.catalogue.get(key);
    if (known) return { bytes: bytesFor(known.contentType, known.size), contentType: known.contentType };
    return { bytes: bytesFor('image/png', 64), contentType: 'image/png' }; // signature PNG URLs
  }
}

export function allFixtures(): Record<string, CognitoEntry[]> {
  return Object.fromEntries(SLUGS.map((s) => [s, fixture(s)]));
}

export function platform(): MemorySink {
  return new MemorySink(ORG, SLUGS.map((s, i) => formRecordFromSpec(spec(s), `00000000-0000-0000-0000-00000000000${i + 1}`, ORG)));
}
