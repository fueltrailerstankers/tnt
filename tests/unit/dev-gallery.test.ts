import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO_ROWS, galleryHref, parseGalleryQuery } from '@/app/(admin)/admin/dev/components/fixtures';

const dir = path.resolve(import.meta.dirname, '../../app/(admin)/admin/dev/components');
const read = (f: string) => readFileSync(path.join(dir, f), 'utf8');

describe('component gallery URL state', () => {
  it('parses status, page and row with safe defaults', () => {
    expect(parseGalleryQuery({})).toEqual({ status: 'all', page: 1, row: null });
    expect(parseGalleryQuery({ status: 'Approved', page: '2', row: '214' })).toEqual({ status: 'Approved', page: 2, row: 214 });
    expect(parseGalleryQuery({ status: 'Nope', page: '-3', row: '9999' })).toEqual({ status: 'all', page: 1, row: null });
    expect(parseGalleryQuery({ status: ['Reviewed', 'Approved'], page: 'x' })).toEqual({ status: 'Reviewed', page: 1, row: null });
  });
  it('builds short links that round-trip', () => {
    expect(galleryHref({})).toBe('/admin/dev/components');
    expect(galleryHref({ status: 'all', page: 1, row: null }, '#table')).toBe('/admin/dev/components#table');
    const href = galleryHref({ status: 'Changes requested', page: 2, row: 210 });
    const sp = Object.fromEntries(new URL(href, 'http://x').searchParams);
    expect(parseGalleryQuery(sp)).toEqual({ status: 'Changes requested', page: 2, row: 210 });
  });
  it('uses fictional rows only', () => {
    for (const r of DEMO_ROWS) {
      expect(r.vin).toMatch(/^TT9DEMO/);
      expect(r.inspector).toMatch(/\b(Demo|Sample|Example)$/);
    }
  });
});

describe('component gallery guards', () => {
  it('checks admin.access first and 404s in production', () => {
    const page = read('page.tsx');
    const m = page.match(/export default async function \w+\([\s\S]*?\)\s*\{\s*([^\n]+)\n\s*([^\n]+)/);
    expect(m?.[1]).toBe("await requirePerm('admin.access');");
    expect(m?.[2]).toBe("if (process.env.NODE_ENV === 'production') notFound();");
  });
  it('starts every server action with requirePerm and never touches data', () => {
    const src = read('actions.ts');
    expect(src.startsWith("'use server';")).toBe(true);
    const actions = [...src.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\s*([^\n]+)/g)];
    expect(actions.length).toBeGreaterThan(0);
    for (const [, name, firstLine] of actions) {
      expect(firstLine.trim(), name).toBe("await requirePerm('admin.access');");
    }
    expect(src).not.toMatch(/createClient|createServiceClient|supabase|\.from\(|\.insert\(|\.update\(|\.delete\(|\.rpc\(|fetch\(/);
  });
});
