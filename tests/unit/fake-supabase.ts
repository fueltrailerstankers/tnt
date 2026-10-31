// In-memory stand-in for the supabase-js query builder, for unit tests of server code that takes a SupabaseClient
// (jobs, stores). Supports only what that code uses: select/insert/update/delete/upsert (with onConflict), eq/gt/lte/in/is/or
// filters (incl. json `col->>key`), order, limit, maybeSingle/single and rpc handlers. Every call is logged with its filters
// so tests can assert how a query was scoped (e.g. always by org). Anything else throws, so a new pattern fails loudly.
import type { SupabaseClient } from '@supabase/supabase-js';

export type Row = Record<string, unknown>;
export interface Filter { col: string; op: 'eq' | 'gt' | 'lte' | 'in' | 'is' | 'or'; val: unknown }
export interface Logged { table: string; op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' | 'rpc'; filters: Filter[]; rows?: Row[]; args?: Row }

export interface FakeOptions {
  /** Unique column sets per table (a row with a null in the set is not checked, as in Postgres). */
  unique?: Record<string, string[][]>;
  /** Column defaults per table, applied on insert. Functions are called per row. */
  defaults?: Record<string, Record<string, unknown | (() => unknown)>>;
  rpc?: Record<string, (args: Row, tables: Record<string, Row[]>) => unknown>;
  /** Called after each insert/update/delete (e.g. to advance a fake clock). */
  onWrite?: (table: string, op: string) => void;
}

let seq = 0;
export const fakeId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function value(r: Row, col: string): unknown {
  const m = /^([a-z_][a-z0-9_]*)->>([A-Za-z0-9_]+)$/.exec(col);
  if (m) {
    const o = r[m[1]] as Record<string, unknown> | null | undefined;
    const v = o?.[m[2]];
    return v === undefined || v === null ? null : String(v);
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(col)) throw new Error(`fake: unsupported column ${col}`);
  return r[col];
}

function matches(r: Row, f: Filter): boolean {
  if (f.op === 'or') return (f.val as Filter[]).some((g) => matches(r, g));
  const v = value(r, f.col);
  switch (f.op) {
    case 'eq': return v !== null && v !== undefined && String(v) === String(f.val);
    case 'gt': return v !== null && v !== undefined && Number(v) > Number(f.val);
    case 'lte': return v !== null && v !== undefined && String(v) <= String(f.val);
    case 'in': return (f.val as unknown[]).map(String).includes(String(v));
    case 'is': return f.val === null ? v === null || v === undefined : v === f.val;
  }
}

function parseOr(s: string): Filter[] {
  return s.split(',').map((part) => {
    const m = /^([a-z_][a-z0-9_]*(?:->>[A-Za-z0-9_]+)?)\.(eq|is)\.(.*)$/.exec(part);
    if (!m) throw new Error(`fake: unsupported or part ${part}`);
    return { col: m[1], op: m[2] as 'eq' | 'is', val: m[2] === 'is' ? (m[3] === 'null' ? null : m[3] === 'true') : m[3] };
  });
}

class Query implements PromiseLike<{ data: unknown; error: { code: string; message: string } | null }> {
  private op: Logged['op'] = 'select';
  private filters: Filter[] = [];
  private returning = false;
  private patch: Row = {};
  private rows: Row[] = [];
  private conflict: string[] = [];
  private sort: { col: string; asc: boolean } | null = null;
  private max: number | null = null;
  private mode: 'many' | 'maybe' | 'single' = 'many';

  constructor(private fake: FakeSupabase, private table: string) {}

  select() { if (this.op !== 'select') this.returning = true; return this; }
  insert(rows: Row | Row[]) { this.op = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  update(patch: Row) { this.op = 'update'; this.patch = patch; return this; }
  upsert(rows: Row | Row[], o?: { onConflict?: string }) {
    if (!o?.onConflict) throw new Error('fake: upsert needs onConflict');
    this.op = 'upsert';
    this.rows = Array.isArray(rows) ? rows : [rows];
    this.conflict = o.onConflict.split(',').map((c) => c.trim());
    return this;
  }
  delete() { this.op = 'delete'; return this; }
  eq(col: string, val: unknown) { this.filters.push({ col, op: 'eq', val }); return this; }
  gt(col: string, val: unknown) { this.filters.push({ col, op: 'gt', val }); return this; }
  lte(col: string, val: unknown) { this.filters.push({ col, op: 'lte', val }); return this; }
  in(col: string, val: unknown[]) { this.filters.push({ col, op: 'in', val }); return this; }
  is(col: string, val: unknown) { this.filters.push({ col, op: 'is', val }); return this; }
  or(s: string) { this.filters.push({ col: '', op: 'or', val: parseOr(s) }); return this; }
  order(col: string, o?: { ascending?: boolean }) { this.sort = { col, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.max = n; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  single() { this.mode = 'single'; return this; }

  then<A = { data: unknown; error: { code: string; message: string } | null }, B = never>(
    ok?: ((v: { data: unknown; error: { code: string; message: string } | null }) => A | PromiseLike<A>) | null,
    fail?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, fail);
  }

  private run(): { data: unknown; error: { code: string; message: string } | null } {
    const f = this.fake;
    const all = (f.tables[this.table] ??= []);
    f.log.push({ table: this.table, op: this.op, filters: this.filters, rows: this.op === 'insert' || this.op === 'upsert' ? this.rows : undefined });
    const hit = (r: Row) => this.filters.every((x) => matches(r, x));
    let out: Row[];
    if (this.op === 'upsert') {
      out = this.rows.map((r) => {
        const existing = all.find((x) => this.conflict.every((c) => String(x[c]) === String(r[c])));
        if (existing) return Object.assign(existing, structuredClone(r));
        const made = { id: fakeId(), ...structuredClone(r) };
        all.push(made);
        return made;
      });
      f.opts.onWrite?.(this.table, 'upsert');
    } else if (this.op === 'insert') {
      const defaults = f.opts.defaults?.[this.table] ?? {};
      const made = this.rows.map((r): Row => {
        const d = Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, typeof v === 'function' ? (v as () => unknown)() : v]));
        return { id: fakeId(), ...d, ...structuredClone(r) };
      });
      for (const r of made) {
        for (const cols of f.opts.unique?.[this.table] ?? []) {
          if (cols.some((c) => r[c] === null || r[c] === undefined)) continue;
          if ([...all, ...made.filter((x) => x !== r)].some((x) => cols.every((c) => String(x[c]) === String(r[c])))) {
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
        }
      }
      all.push(...made);
      f.opts.onWrite?.(this.table, 'insert');
      out = made;
    } else if (this.op === 'update') {
      out = all.filter(hit);
      for (const r of out) Object.assign(r, structuredClone(this.patch));
      f.opts.onWrite?.(this.table, 'update');
    } else if (this.op === 'delete') {
      out = all.filter(hit);
      f.tables[this.table] = all.filter((r) => !out.includes(r));
      f.opts.onWrite?.(this.table, 'delete');
    } else {
      out = all.filter(hit);
      if (this.sort) {
        const { col, asc } = this.sort;
        out = [...out].sort((a, b) => (String(a[col]).localeCompare(String(b[col]), 'en', { numeric: true })) * (asc ? 1 : -1));
      }
      if (this.max !== null) out = out.slice(0, this.max);
    }
    const data = structuredClone(out);
    if (this.op !== 'select' && !this.returning) return { data: null, error: null };
    if (this.mode === 'maybe') {
      if (data.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } };
      return { data: data[0] ?? null, error: null };
    }
    if (this.mode === 'single') {
      if (data.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'not one row' } };
      return { data: data[0], error: null };
    }
    return { data, error: null };
  }
}

export class FakeSupabase {
  log: Logged[] = [];
  constructor(public tables: Record<string, Row[]>, public opts: FakeOptions = {}) {}

  get client(): SupabaseClient {
    const from = (table: string) => new Query(this, table);
    const rpc = async (fn: string, args: Row) => {
      this.log.push({ table: fn, op: 'rpc', filters: [], args });
      const h = this.opts.rpc?.[fn];
      if (!h) throw new Error(`fake: no rpc ${fn}`);
      return { data: h(args, this.tables), error: null };
    };
    return { from, rpc } as unknown as SupabaseClient;
  }

  /** Logged calls on a table (or rpc name). */
  calls(table: string): Logged[] {
    return this.log.filter((l) => l.table === table);
  }
}

/** The eq value a call filtered `col` on, if any. */
export const eqOf = (l: Logged, col: string): unknown => l.filters.find((f) => f.op === 'eq' && f.col === col)?.val;
