import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseSpec, type FormSpec } from '@/lib/spec/types';

const dir = path.resolve(__dirname, '../../docs/source/tt-forms/spec/forms');

export const SLUGS = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();

export function spec(slug: string): FormSpec {
  return parseSpec(JSON.parse(readFileSync(path.join(dir, `${slug}.json`), 'utf8')));
}

/** FormData-like getter from a plain object (arrays become repeated values). */
export function fd(values: Record<string, string | string[]>) {
  return {
    get: (k: string) => {
      const v = values[k];
      return v === undefined ? null : Array.isArray(v) ? (v[0] ?? null) : v;
    },
    getAll: (k: string) => {
      const v = values[k];
      return v === undefined ? [] : Array.isArray(v) ? v : [v];
    },
  };
}
