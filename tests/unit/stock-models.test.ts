import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODEL_CATEGORIES, partKey, STOCK_LOCATIONS, STOCK_MODELS } from '@/lib/stock/models';

const sql = readFileSync(path.resolve(__dirname, '../../supabase/migrations/0011_stock.sql'), 'utf8');
const unquote = (s: string) => s.replace(/''/g, "'");

function section(startMarker: string, endMarker: string): string {
  const start = sql.indexOf(startMarker);
  expect(start, startMarker).toBeGreaterThan(-1);
  const end = sql.indexOf(endMarker, start);
  expect(end, endMarker).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe('stock models', () => {
  it('lists the 52 models with unique part numbers and the client spelling', () => {
    expect(STOCK_MODELS).toHaveLength(52);
    expect(new Set(STOCK_MODELS.map((m) => m.partNumber)).size).toBe(52);
    const text = STOCK_MODELS.map((m) => m.description).join('\n');
    for (const quirk of ['SINGEL', 'CRADEL', 'Dubbel axel']) expect(text).toContain(quirk);
    expect(STOCK_MODELS[0].partNumber).toBe('CTLL1');
    expect(STOCK_MODELS.at(-1)!.partNumber).toBe('BOX10');
  });

  it('matches the 0011 seed exactly: order, part number, description, category', () => {
    const block = section('insert into public.stock_models', ') as m(part_number');
    const rows = [...block.matchAll(/\('((?:[^']|'')*)', '((?:[^']|'')*)', '([a-z_]+)', (\d+)\)/g)].map((m) => ({
      partNumber: unquote(m[1]),
      description: unquote(m[2]),
      category: m[3],
      sortOrder: Number(m[4]),
    }));
    expect(rows).toEqual(STOCK_MODELS.map((m, i) => ({ ...m, sortOrder: i + 1 })));
  });

  it('matches the seeded locations', () => {
    const block = section('insert into public.stock_locations', 'on conflict do nothing');
    const rows = [...block.matchAll(/\('[0-9a-f-]+', '([A-Z]+)', '([^']+)', (true|false), (\d+)\)/g)].map((m) => ({
      id: m[1], name: m[2], isFactory: m[3] === 'true', sortOrder: Number(m[4]),
    }));
    expect(rows).toEqual(STOCK_LOCATIONS);
  });

  it('uses the categories the database allows', () => {
    const block = section("category text not null check (category in (", '))');
    const allowed = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(allowed).toEqual([...MODEL_CATEGORIES]);
    for (const m of STOCK_MODELS) expect(MODEL_CATEGORIES).toContain(m.category);
  });

  it('part keys ignore case and spaces', () => {
    expect(partKey(' ctll 3d ')).toBe('CTLL3D');
    expect(partKey(null)).toBe('');
  });
});
