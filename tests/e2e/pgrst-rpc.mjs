// POST /rest/v1/rpc/<fn> as mini-supabase serves it. Test-only; shared with tests/db/stub-rpc.test.ts so the
// response shape is checked against real functions.
//
// Like PostgREST: a function that does not return SETOF answers with one JSON value: the bare scalar for a scalar
// (`returns boolean`), the row as an object for a composite (`returns public.stock_units`), or null. SETOF / TABLE
// functions answer with an array. Pseudo-type results (void, record) keep the array; no app RPC returns one.
//
// `quote` validates and quotes an identifier (the stub's ident, which rejects anything unexpected).
export async function runRpc(client, fn, body, quote) {
  const values = [];
  const args = body && typeof body === 'object' ? Object.entries(body) : [];
  const sqlArgs = args.map(([k, v]) => { values.push(v); return `${quote(k)} => $${values.length}`; }).join(', ');
  const r = await client.query(`select coalesce(json_agg(x), '[]'::json) as j from public.${quote(fn)}(${sqlArgs}) x`, values);
  const kind = await client.query(
    `select p.proretset, t.typtype from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
     where n.nspname = 'public' and p.proname = $1 limit 1`, [fn]);
  const k = kind.rows[0];
  // json_agg over a non-SETOF function holds its single result: [true] for a scalar, [{...}] for a composite.
  if (k && !k.proretset && k.typtype !== 'p') return r.rows[0].j[0] ?? null;
  return r.rows[0].j;
}
