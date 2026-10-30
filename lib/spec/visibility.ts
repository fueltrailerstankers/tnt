// Show-when visibility (M8). Pure; used by validateEntry/prepareSave on the server and by the renderer in
// the browser, so both hide the same fields.
//
// A field is hidden when its own showWhen is false or when the heading section it sits under is hidden
// (a heading groups the fields after it, up to the next heading or page break). A rule reads other
// fields' values; a field that is itself hidden reads as empty. Rules may not depend on each other in a
// cycle (parseSpec rejects that), so the result does not depend on evaluation order and is the same when
// computed again from the saved data (hidden values are dropped on save).
import { parseShowWhen, type ShowContext } from './expressions';
import type { FieldSpec, FormSpec } from './types';

type Rule = ReturnType<typeof parseShowWhen>;
const ruleCache = new Map<string, Rule>();

function rule(expr: string): Rule {
  let r = ruleCache.get(expr);
  if (!r) {
    r = parseShowWhen(expr);
    if (ruleCache.size > 500) ruleCache.clear();
    ruleCache.set(expr, r);
  }
  return r;
}

export function isHeading(f: FieldSpec): f is Extract<FieldSpec, { type: 'section' }> {
  return f.type === 'section' && f.children === undefined;
}

export function isChecklistSection(f: FieldSpec): boolean {
  return f.type === 'section' && f.children !== undefined;
}

function showWhenOf(f: FieldSpec): string | undefined {
  return 'showWhen' in f && typeof f.showWhen === 'string' && f.showWhen.trim() ? f.showWhen : undefined;
}

/** True when the spec uses showWhen anywhere (the renderer only tracks values when it does). */
export function hasShowWhen(spec: FormSpec): boolean {
  return spec.fields.some((f) => showWhenOf(f) !== undefined);
}

/** Fields in layout order (row, then column), the order pages() uses. */
function layoutOrder(spec: FormSpec): FieldSpec[] {
  const col = (f: FieldSpec) => ('col' in f && f.col ? f.col : 1);
  return [...spec.fields].sort((a, b) => a.row - b.row || col(a) - col(b));
}

/** The heading section each field sits under (none before the first heading or after a page break). */
export function headingOf(spec: FormSpec): Map<FieldSpec, FieldSpec> {
  const out = new Map<FieldSpec, FieldSpec>();
  let current: FieldSpec | null = null;
  for (const f of layoutOrder(spec)) {
    if (f.type === 'pagebreak') current = null;
    else if (isHeading(f)) current = f;
    else if (current) out.set(f, current);
  }
  return out;
}

function named(spec: FormSpec): Map<string, FieldSpec> {
  const m = new Map<string, FieldSpec>();
  for (const f of spec.fields) if ('name' in f && f.name && f.type !== 'table') m.set(f.name, f);
  return m;
}

function emptyish(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).every(emptyish);
  return false;
}

/** The set of hidden fields (field spec objects, so content blocks and sections are covered too). */
export function hiddenFields(spec: FormSpec, data: Record<string, unknown>): Set<FieldSpec> {
  const hidden = new Set<FieldSpec>();
  if (!hasShowWhen(spec)) return hidden;
  const byName = named(spec);
  const heading = headingOf(spec);
  const memo = new Map<FieldSpec, boolean>();
  const visiting = new Set<FieldSpec>();

  const isHidden = (f: FieldSpec): boolean => {
    const known = memo.get(f);
    if (known !== undefined) return known;
    if (visiting.has(f)) throw new Error('showWhen rules depend on each other in a cycle');
    visiting.add(f);
    let h = false;
    const sec = heading.get(f);
    if (sec && isHidden(sec)) h = true;
    const expr = showWhenOf(f);
    if (!h && expr) {
      const value = (name: string) => {
        const other = byName.get(name);
        if (other && isHidden(other)) return undefined;
        return data[name];
      };
      const ctx: ShowContext = { value, isEmpty: (name) => emptyish(value(name)) };
      h = !rule(expr).test(ctx);
    }
    visiting.delete(f);
    memo.set(f, h);
    return h;
  };

  for (const f of spec.fields) if (f.type !== 'pagebreak' && isHidden(f)) hidden.add(f);
  return hidden;
}

/** Names of hidden input fields. */
export function hiddenNames(spec: FormSpec, data: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  for (const f of hiddenFields(spec, data)) if ('name' in f && f.name) out.add(f.name);
  return out;
}

/** Spec problems with showWhen rules: syntax, unknown fields, cycles. Empty when fine. */
export function showWhenProblems(spec: FormSpec): Array<{ index: number; message: string }> {
  const problems: Array<{ index: number; message: string }> = [];
  const byName = named(spec);
  const deps = new Map<FieldSpec, FieldSpec[]>();
  const heading = headingOf(spec);
  spec.fields.forEach((f, index) => {
    const d: FieldSpec[] = [];
    const sec = heading.get(f);
    if (sec) d.push(sec);
    const expr = showWhenOf(f);
    if (expr) {
      try {
        for (const n of rule(expr).fields) {
          const other = byName.get(n);
          if (!other) problems.push({ index, message: `showWhen refers to an unknown field: ${n}` });
          else d.push(other);
        }
      } catch (e) {
        problems.push({ index, message: (e as Error).message });
      }
    }
    deps.set(f, d);
  });
  // Cycle check (depth-first, colours).
  const state = new Map<FieldSpec, 1 | 2>();
  const visit = (f: FieldSpec): boolean => {
    const s = state.get(f);
    if (s === 2) return false;
    if (s === 1) return true;
    state.set(f, 1);
    for (const d of deps.get(f) ?? []) if (visit(d)) return true;
    state.set(f, 2);
    return false;
  };
  spec.fields.forEach((f, index) => {
    if (state.get(f) === undefined && visit(f)) problems.push({ index, message: 'showWhen rules depend on each other in a cycle' });
  });
  return problems;
}
