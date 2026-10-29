// The two small expression languages used by the specs. Pure. Unknown syntax throws so a spec
// change cannot silently turn a rule into "always true".
//
// allowedWhen:  always | status == 'X' | status != 'X' | <clause> AND role == 'Y'
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
