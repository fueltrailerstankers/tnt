// The two small expression languages used by the specs. Pure. Unknown syntax throws so a spec
// change cannot silently turn a rule into "always true".
//
// allowedWhen:  always | status == 'X' | status != 'X' | status in ('X', 'Y') | <clause> AND role == 'Y'
// customError:  <Field> is empty | <Field> has 0 files, joined with AND

export interface ActionContext {
  status: string;
  role: string;
}

type Pred<C> = (c: C) => boolean;

function conj<C>(expr: string, clause: (s: string) => Pred<C>): Pred<C> {
  const preds = expr.split(/\s+AND\s+/).map((s) => clause(s.trim()));
  return (c) => preds.every((p) => p(c));
}

export function parseAllowedWhen(expr: string): Pred<ActionContext> {
  if (expr.trim() === 'always') return () => true;
  return conj<ActionContext>(expr, (s) => {
    // M8 builder: status in ('A', 'B') ("allowed when status is one of").
    const list = s.match(/^(status|role)\s+in\s+\((\s*'[^']*'\s*(?:,\s*'[^']*'\s*)*)\)$/);
    if (list) {
      const key = list[1] as 'status' | 'role';
      const values = [...list[2].matchAll(/'([^']*)'/g)].map((x) => x[1]);
      return (c) => values.includes(c[key]);
    }
    const m = s.match(/^(status|role)\s*(==|!=)\s*'([^']*)'$/);
    if (!m) throw new Error(`Unsupported allowedWhen clause: ${s}`);
    const [, key, op, value] = m;
    return (c) => (op === '==' ? c[key as 'status' | 'role'] === value : c[key as 'status' | 'role'] !== value);
  });
}

export interface ValueContext {
  /** True when the field has no value (empty string, null, empty name/address parts, empty array). */
  isEmpty: (field: string) => boolean;
  fileCount: (field: string) => number;
}

export function parseErrorWhen(expr: string): { test: Pred<ValueContext>; fields: string[] } {
  const fields: string[] = [];
  const test = conj<ValueContext>(expr, (s) => {
    let m = s.match(/^([A-Za-z_][A-Za-z0-9_]*) is empty$/);
    if (m) {
      const f = m[1];
      fields.push(f);
      return (c) => c.isEmpty(f);
    }
    m = s.match(/^([A-Za-z_][A-Za-z0-9_]*) has 0 files$/);
    if (m) {
      const f = m[1];
      fields.push(f);
      return (c) => c.fileCount(f) === 0;
    }
    throw new Error(`Unsupported customError clause: ${s}`);
  });
  return { test, fields };
}

/** Some kit messages carry a note instead of copy, e.g. "(Cognito default) suggest: 'Enter ...'". Use the suggestion. */
export function errorMessage(raw: string): string {
  const suggested = raw.match(/suggest:\s*'([^']+)'/);
  return suggested ? suggested[1] : raw;
}

// --- showWhen (M8) ----------------------------------------------------------------------------------
// Conditional visibility for fields, sections and content blocks. Same parser on the server
// (validateEntry/prepareSave) and in the browser (FormRenderer), so both agree on what is hidden.
//
//   expr    := and ( OR and )*
//   and     := term ( AND term )*
//   term    := '(' expr ')' | clause
//   clause  := Field op literal | Field contains literal | Field is empty | Field is not empty
//   op      := = | == | != | <> | > | >= | < | <=
//   literal := "text" | 'text' | number | true | false
//
// Keywords are case-insensitive. Examples: MONTH = "JAN", YesNo1 = true, Rating >= 4,
// Colours contains "Red" AND Notes is not empty. Unknown syntax throws.

export type ShowLiteral = string | number | boolean;

export interface ShowContext {
  /** The field's stored value, or undefined when it is empty or hidden. */
  value: (field: string) => unknown;
  isEmpty: (field: string) => boolean;
}

type Tok = { k: 'id'; v: string } | { k: 'str'; v: string } | { k: 'num'; v: number } | { k: 'op'; v: string } | { k: '(' } | { k: ')' };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') { out.push({ k: c }); i++; continue; }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new Error(`Unterminated text in showWhen: ${src}`);
      out.push({ k: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const op = src.slice(i).match(/^(==|!=|<>|>=|<=|=|>|<)/);
    if (op) { out.push({ k: 'op', v: op[1] === '==' ? '=' : op[1] === '<>' ? '!=' : op[1] }); i += op[1].length; continue; }
    const num = src.slice(i).match(/^-?\d+(\.\d+)?(?![A-Za-z0-9_])/);
    if (num) { out.push({ k: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (id) { out.push({ k: 'id', v: id[0] }); i += id[0].length; continue; }
    throw new Error(`Unsupported character in showWhen: ${src}`);
  }
  return out;
}

type Node = (c: ShowContext) => boolean;

/** Comparable form of a stored value: currency -> amount, phone -> as typed, else as stored. */
export function comparable(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o.amount === 'number' && typeof o.currency === 'string') return o.amount;
    if (typeof o.phone === 'string' && typeof o.digits === 'string') return o.phone;
  }
  return v;
}

function eq(a: unknown, lit: ShowLiteral): boolean {
  if (Array.isArray(a)) return a.some((x) => eq(x, lit));
  if (typeof lit === 'boolean') return a === lit;
  if (typeof lit === 'number') return a !== undefined && a !== null && a !== '' && Number(a) === lit;
  if (a === undefined || a === null) return lit === '';
  return String(a) === lit;
}

function cmp(a: unknown, op: string, lit: ShowLiteral): boolean {
  if (a === undefined || a === null || a === '' || Array.isArray(a) || typeof lit === 'boolean') return false;
  let x: number | string;
  let y: number | string;
  if (typeof lit === 'number') {
    x = Number(a);
    y = lit;
    if (Number.isNaN(x)) return false;
  } else {
    x = String(a);
    y = lit;
  }
  return op === '>' ? x > y : op === '>=' ? x >= y : op === '<' ? x < y : x <= y;
}

/** Parses a showWhen rule. `fields` lists the field names it reads (for spec checks and dependency order). */
export function parseShowWhen(expr: string): { test: Node; fields: string[] } {
  const toks = tokenize(expr);
  const fields: string[] = [];
  let p = 0;
  const peek = () => toks[p];
  const kw = (word: string) => {
    const t = toks[p];
    return t?.k === 'id' && t.v.toLowerCase() === word;
  };
  const literal = (): ShowLiteral => {
    const t = toks[p++];
    if (!t) throw new Error(`Missing value in showWhen: ${expr}`);
    if (t.k === 'str' || t.k === 'num') return t.v;
    if (t.k === 'id' && /^(true|false)$/i.test(t.v)) return t.v.toLowerCase() === 'true';
    throw new Error(`Expected a value in showWhen: ${expr}`);
  };
  const clause = (): Node => {
    const t = toks[p++];
    if (!t || t.k !== 'id') throw new Error(`Expected a field name in showWhen: ${expr}`);
    const f = t.v;
    fields.push(f);
    if (kw('is')) {
      p++;
      const not = kw('not');
      if (not) p++;
      if (!kw('empty')) throw new Error(`Expected "is empty" or "is not empty" in showWhen: ${expr}`);
      p++;
      return not ? (c) => !c.isEmpty(f) : (c) => c.isEmpty(f);
    }
    if (kw('contains')) {
      p++;
      const lit = literal();
      const needle = String(lit).toLowerCase();
      return (c) => {
        const v = comparable(c.value(f));
        if (Array.isArray(v)) return v.some((x) => String(x) === String(lit));
        return v !== undefined && v !== null && String(v).toLowerCase().includes(needle);
      };
    }
    const o = toks[p++];
    if (!o || o.k !== 'op') throw new Error(`Expected a comparison in showWhen: ${expr}`);
    const lit = literal();
    if (o.v === '=') return (c) => eq(comparable(c.value(f)), lit);
    if (o.v === '!=') return (c) => !eq(comparable(c.value(f)), lit);
    return (c) => cmp(comparable(c.value(f)), o.v, lit);
  };
  const term = (): Node => {
    if (peek()?.k === '(') {
      p++;
      const n = or();
      if (peek()?.k !== ')') throw new Error(`Missing ")" in showWhen: ${expr}`);
      p++;
      return n;
    }
    return clause();
  };
  const and = (): Node => {
    const parts = [term()];
    while (kw('and')) { p++; parts.push(term()); }
    return parts.length === 1 ? parts[0] : (c) => parts.every((n) => n(c));
  };
  function or(): Node {
    const parts = [and()];
    while (kw('or')) { p++; parts.push(and()); }
    return parts.length === 1 ? parts[0] : (c) => parts.some((n) => n(c));
  }
  if (!toks.length) throw new Error('Empty showWhen');
  const test = or();
  if (p !== toks.length) throw new Error(`Unexpected text in showWhen: ${expr}`);
  return { test, fields: [...new Set(fields)] };
}
