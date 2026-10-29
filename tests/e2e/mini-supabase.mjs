// Test-only stand-in for Supabase, used by the Playwright suite. Never deployed.
//
// - REST (/rest/v1): a PostgREST-compatible subset translated to SQL against a REAL local Postgres built
//   from tests/db/shim.sql + supabase/migrations. Every request runs inside a transaction as the caller's
//   API role (anon / authenticated with JWT claims / service_role), so RLS and grants are the real ones.
// - Auth (/auth/v1): password grant, refresh, user, logout for synthetic users (HS256 JWTs).
// - Storage (/storage/v1): in-memory objects with signed upload/download URLs, info, move, remove.
//
// All identities and data are synthetic. Supported query syntax is only what the app uses; anything else
// returns 400 so a new pattern fails loudly instead of being silently misread.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const PORT = Number(process.env.STUB_PORT ?? 54399);
const ANON_KEY = 'stub-anon-key';
const SERVICE_KEY = 'stub-service-key';
const SECRET = randomBytes(32);
const E2E_DB = 'tt_e2e';

export const USERS = [
  { id: '00000000-0000-0000-0000-00000000a001', email: 'admin@example.invalid', password: 'correct-horse-battery', role: 'admin', name: 'Test Admin' },
];
const ORG = '00000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------------------------------
const adminUrl = process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres';
const dbUrl = new URL(adminUrl);
dbUrl.pathname = `/${E2E_DB}`;

async function setupDatabase() {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${E2E_DB} with (force)`);
  await admin.query(`create database ${E2E_DB}`);
  await admin.end();
  const c = new pg.Client({ connectionString: dbUrl.toString() });
  await c.connect();
  await c.query(readFileSync(path.join(root, 'tests/db/shim.sql'), 'utf8'));
  const dir = path.join(root, 'supabase/migrations');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await c.query(readFileSync(path.join(dir, f), 'utf8'));
  for (const u of USERS) {
    await c.query(`insert into auth.users(id, email) values ($1, $2)`, [u.id, u.email]);
    await c.query(`insert into public.profiles(id, email, full_name, role) values ($1, $2, $3, $4)`, [u.id, u.email, u.name, u.role]);
    await c.query(`insert into public.memberships(org_id, user_id, role) values ($1, $2, $3)`, [ORG, u.id, u.role]);
  }
  // Route every notification to synthetic inboxes so no real address appears in test output.
  await c.query(`update public.notification_recipients set address = replace(address, '@fueltrailers.co.za', '@example.invalid')`);
  await c.end();
}

const pool = new pg.Pool({ connectionString: dbUrl.toString(), max: 8 });

// ---------------------------------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------------------------------
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(payload) {
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${head}.${createHmac('sha256', SECRET).update(head).digest('base64url')}`;
}
function verify(token) {
  const [h, p, s] = String(token).split('.');
  if (!h || !p || !s) return null;
  if (createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  return claims.exp > Date.now() / 1000 ? claims : null;
}
const refreshTokens = new Map();
function session(u) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const refresh = randomBytes(16).toString('hex');
  refreshTokens.set(refresh, u.id);
  return {
    access_token: sign({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, exp, iat: exp - 3600, session_id: randomUUID() }),
    token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: refresh, user: userJson(u),
  };
}
const userJson = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });

/** Maps the Authorization bearer to an API role and JWT claims. */
function identity(req) {
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (bearer === SERVICE_KEY) return { role: 'service_role', claims: { role: 'service_role' } };
  if (!bearer || bearer === ANON_KEY) return { role: 'anon', claims: { role: 'anon' } };
  const c = verify(bearer);
  return c ? { role: 'authenticated', claims: c } : null;
}

// ---------------------------------------------------------------------------------------------------
// REST -> SQL
// ---------------------------------------------------------------------------------------------------
class HttpError extends Error {
  constructor(status, body) { super(body.message); this.status = status; this.body = body; }
}
const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (s) => { if (!IDENT.test(s)) throw new HttpError(400, { message: `unsupported identifier ${s}` }); return `"${s}"`; };
function column(key) {
  const m = key.match(/^([a-z_][a-z0-9_]*)(?:(->>?)([A-Za-z0-9_]+))?$/);
  if (!m) throw new HttpError(400, { message: `unsupported column ${key}` });
  return m[2] ? `${ident(m[1])}${m[2]}'${m[3]}'` : ident(m[1]);
}
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function parseList(v) {
  const inner = v.replace(/^\(/, '').replace(/\)$/, '');
  const out = [];
  let cur = '', q = false;
  for (const ch of inner) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function where(params, values) {
  const clauses = [];
  for (const [key, raw] of params) {
    if (RESERVED.has(key)) continue;
    const col = column(key);
    let v = raw, neg = false;
    if (v.startsWith('not.')) { neg = true; v = v.slice(4); }
    const dot = v.indexOf('.');
    const op = v.slice(0, dot), arg = v.slice(dot + 1);
    let sql;
    const p = (x) => { values.push(x); return `$${values.length}`; };
    switch (op) {
      case 'eq': sql = `${col} = ${p(arg)}`; break;
      case 'neq': sql = `${col} <> ${p(arg)}`; break;
      case 'gt': sql = `${col} > ${p(arg)}`; break;
      case 'gte': sql = `${col} >= ${p(arg)}`; break;
      case 'lt': sql = `${col} < ${p(arg)}`; break;
      case 'lte': sql = `${col} <= ${p(arg)}`; break;
      case 'like': sql = `${col}::text like ${p(arg.replaceAll('*', '%'))}`; break;
      case 'ilike': sql = `${col}::text ilike ${p(arg.replaceAll('*', '%'))}`; break;
      case 'in': sql = `${col}::text = any(${p(parseList(arg))}::text[])`; break;
      case 'is':
        if (!['null', 'true', 'false'].includes(arg)) throw new HttpError(400, { message: `unsupported is.${arg}` });
        sql = `${col} is ${arg}`; break;
      default: throw new HttpError(400, { message: `unsupported operator ${op}` });
    }
    clauses.push(neg ? `not (${sql})` : sql);
  }
  return clauses.length ? `where ${clauses.join(' and ')}` : '';
}

function selectList(sel) {
  if (!sel || sel === '*') return null;
  return sel.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    if (s.includes('(')) throw new HttpError(400, { message: 'embedding not supported' });
    if (!IDENT.test(s)) throw new HttpError(400, { message: `unsupported select ${s}` });
    return s;
  });
}

function orderBy(o) {
  if (!o) return '';
  return 'order by ' + o.split(',').map((part) => {
    const [c, ...mods] = part.split('.');
    const dir = mods.includes('desc') ? 'desc' : 'asc';
    const nulls = mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : '';
    return `${column(c)} ${dir}${nulls}`;
  }).join(', ');
}

const pick = (rows, cols) => (cols ? rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))) : rows);

async function withRole(id, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${id.role}`);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(id.claims)]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

function pgError(e) {
  const status = e.code === '42501' ? 403 : e.code === '23505' ? 409 : e.code === 'P0001' ? 400 : 400;
  return new HttpError(status, { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
}

async function rest(req, url, body) {
  const id = identity(req);
  if (!id) throw new HttpError(401, { message: 'invalid JWT' });
  const parts = url.pathname.replace(/^\/rest\/v1\//, '').split('/');
  const params = [...url.searchParams.entries()];
  const prefer = String(req.headers.prefer ?? '');
  const accept = String(req.headers.accept ?? '');
  const single = accept.includes('vnd.pgrst.object');
  const wantCount = /count=exact/.test(prefer);
  const values = [];

  try {
    return await withRole(id, async (c) => {
      if (parts[0] === 'rpc') {
        const fn = ident(parts[1]);
        const args = body && typeof body === 'object' ? Object.entries(body) : [];
        const sqlArgs = args.map(([k, v]) => { values.push(v); return `${ident(k)} => $${values.length}`; }).join(', ');
        const r = await c.query(`select coalesce(json_agg(x), '[]'::json) as j from public.${fn}(${sqlArgs}) x`, values);
        return { status: 200, json: r.rows[0].j };
      }
      const table = `public.${ident(parts[0])}`;
      const cols = selectList(url.searchParams.get('select'));
      const filter = where(params, values);

      if (req.method === 'GET' || req.method === 'HEAD') {
        let limit = url.searchParams.get('limit');
        let offset = url.searchParams.get('offset');
        const range = String(req.headers.range ?? '').match(/^(\d+)-(\d+)$/);
        if (range) { offset = range[1]; limit = String(Number(range[2]) - Number(range[1]) + 1); }
        const lim = limit ? `limit ${Number(limit)}` : '';
        const off = offset ? `offset ${Number(offset)}` : '';
        const list = cols ? cols.map(ident).join(', ') : '*';
        let total = null;
        if (wantCount) total = (await c.query(`select count(*)::int as n from ${table} ${filter}`, values)).rows[0].n;
        if (req.method === 'HEAD') return { status: 200, json: undefined, total, from: 0, len: 0 };
        const r = await c.query(`select coalesce(json_agg(x), '[]'::json) as j from (select ${list} from ${table} ${filter} ${orderBy(url.searchParams.get('order'))} ${lim} ${off}) x`, values);
        return { status: 200, json: r.rows[0].j, total, from: Number(offset ?? 0), single };
      }

      const returning = /return=representation/.test(prefer);
      if (req.method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        if (!rows.length) return { status: 201, json: [] };
        const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].map((k) => { ident(k); return k; });
        values.push(JSON.stringify(rows));
        const colSql = keys.map(ident).join(', ');
        let conflict = '';
        const onConflict = url.searchParams.get('on_conflict');
        if (/resolution=merge-duplicates/.test(prefer)) {
          const target = (onConflict ?? 'id').split(',').map(ident).join(', ');
          conflict = `on conflict (${target}) do update set ${keys.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(', ')}`;
        } else if (/resolution=ignore-duplicates/.test(prefer)) conflict = 'on conflict do nothing';
        const r = await c.query(
          `with ins as (insert into ${table} (${colSql}) select ${colSql} from json_populate_recordset(null::${table}, $${values.length}::json) ${conflict} returning *)
           select coalesce(json_agg(ins), '[]'::json) as j from ins`, values);
        return { status: 201, json: returning ? pick(r.rows[0].j, cols) : undefined, single };
      }
      if (req.method === 'PATCH') {
        const keys = Object.keys(body ?? {}).map((k) => { ident(k); return k; });
        if (!keys.length) throw new HttpError(400, { message: 'empty update' });
        values.push(JSON.stringify(body));
        const set = keys.map((k) => `${ident(k)} = _r.${ident(k)}`).join(', ');
        const r = await c.query(
          `with upd as (update ${table} set ${set} from json_populate_record(null::${table}, $${values.length}::json) _r ${filter} returning ${table}.*)
           select coalesce(json_agg(upd), '[]'::json) as j from upd`, values);
        return { status: 200, json: returning ? pick(r.rows[0].j, cols) : undefined, single };
      }
      if (req.method === 'DELETE') {
        const r = await c.query(`with del as (delete from ${table} ${filter} returning *) select coalesce(json_agg(del), '[]'::json) as j from del`, values);
        return { status: 200, json: returning ? pick(r.rows[0].j, cols) : undefined, single };
      }
      throw new HttpError(405, { message: 'method not allowed' });
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw pgError(e);
  }
}

// ---------------------------------------------------------------------------------------------------
// Storage (in memory)
// ---------------------------------------------------------------------------------------------------
const objects = new Map(); // `${bucket}/${path}` -> { bytes, contentType, created }
const tokens = new Map(); // token -> { key, kind: 'upload'|'download', exp }
const LIMITS = { 'entry-files': 20 * 1024 * 1024, documents: 50 * 1024 * 1024 };

function newToken(key, kind, seconds) {
  const t = randomBytes(18).toString('hex');
  tokens.set(t, { key, kind, exp: Date.now() + seconds * 1000 });
  return t;
}
function checkToken(t, key, kind) {
  const x = tokens.get(t);
  return x && x.key === key && x.kind === kind && x.exp > Date.now();
}

async function readUpload(req, raw) {
  const type = String(req.headers['content-type'] ?? '');
  if (type.startsWith('multipart/form-data')) {
    const fd = await new Request('http://x', { method: 'POST', headers: { 'content-type': type }, body: raw }).formData();
    for (const [, v] of fd) if (typeof v !== 'string') return { bytes: Buffer.from(await v.arrayBuffer()), contentType: v.type || 'application/octet-stream' };
    throw new HttpError(400, { message: 'no file part' });
  }
  return { bytes: raw, contentType: type || 'application/octet-stream' };
}

async function storage(req, url, raw) {
  const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\//, ''));
  const id = identity(req);
  const service = id?.role === 'service_role';
  let m;

  if ((m = p.match(/^object\/upload\/sign\/([^/]+)\/(.+)$/))) {
    const key = `${m[1]}/${m[2]}`;
    if (req.method === 'POST') {
      if (!service) throw new HttpError(403, { message: 'service role required' });
      return { json: { url: `/object/upload/sign/${key}?token=${newToken(key, 'upload', 7200)}` } };
    }
    if (req.method === 'PUT') {
      if (!checkToken(url.searchParams.get('token'), key, 'upload')) throw new HttpError(400, { message: 'invalid signature' });
      const up = await readUpload(req, raw);
      if (up.bytes.length > (LIMITS[m[1]] ?? 0)) throw new HttpError(413, { message: 'Payload too large' });
      objects.set(key, { ...up, created: new Date().toISOString() });
      return { json: { Key: key } };
    }
  }
  if ((m = p.match(/^object\/sign\/([^/]+)\/(.+)$/))) {
    const key = `${m[1]}/${m[2]}`;
    if (req.method === 'POST') {
      if (!service) throw new HttpError(403, { message: 'service role required' });
      if (!objects.has(key)) throw new HttpError(404, { message: 'Object not found' });
      return { json: { signedURL: `/object/sign/${key}?token=${newToken(key, 'download', 60)}` } };
    }
    if (req.method === 'GET') {
      if (!checkToken(url.searchParams.get('token'), key, 'download')) throw new HttpError(400, { message: 'invalid signature' });
      return { object: objects.get(key), download: url.searchParams.get('download') };
    }
  }
  if (!service) throw new HttpError(403, { message: 'service role required' });
  if ((m = p.match(/^object\/info\/([^/]+)\/(.+)$/))) {
    const o = objects.get(`${m[1]}/${m[2]}`);
    if (!o) throw new HttpError(404, { message: 'Object not found' });
    return { json: { name: m[2], size: o.bytes.length, content_type: o.contentType, created_at: o.created, metadata: { size: o.bytes.length, mimetype: o.contentType } } };
  }
  if (p === 'object/move' && req.method === 'POST') {
    const b = JSON.parse(raw.toString() || '{}');
    const from = `${b.bucketId}/${b.sourceKey}`;
    const to = `${b.destinationBucket ?? b.bucketId}/${b.destinationKey}`;
    if (!objects.has(from)) throw new HttpError(404, { message: 'Object not found' });
    if (objects.has(to)) throw new HttpError(409, { message: 'The resource already exists' });
    objects.set(to, objects.get(from));
    objects.delete(from);
    return { json: { message: 'Successfully moved' } };
  }
  if ((m = p.match(/^object\/([^/]+)$/)) && req.method === 'DELETE') {
    const b = JSON.parse(raw.toString() || '{}');
    const gone = (b.prefixes ?? []).filter((x) => objects.delete(`${m[1]}/${x}`));
    return { json: gone.map((name) => ({ name })) };
  }
  if ((m = p.match(/^object\/(?:authenticated\/)?([^/]+)\/(.+)$/))) {
    const key = `${m[1]}/${m[2]}`;
    if (req.method === 'POST') {
      if (objects.has(key) && req.headers['x-upsert'] !== 'true') throw new HttpError(409, { message: 'The resource already exists' });
      const up = await readUpload(req, raw);
      objects.set(key, { ...up, created: new Date().toISOString() });
      return { json: { Key: key } };
    }
    if (req.method === 'GET') return { object: objects.get(key) };
  }
  throw new HttpError(400, { message: `unsupported storage call ${req.method} ${p}` });
}

// ---------------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------------
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-upsert, prefer, range, accept-profile, content-profile, cache-control, x-supabase-api-version',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
  'access-control-expose-headers': 'content-range',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...CORS, ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://stub');
    try {
      if (req.method === 'OPTIONS') return send(res, 204);
      if (url.pathname === '/health') return send(res, 200, { ok: true });

      if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
        const b = JSON.parse(raw.toString() || '{}');
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          const uid = refreshTokens.get(b.refresh_token);
          const u = USERS.find((x) => x.id === uid);
          return u ? send(res, 200, session(u)) : send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        }
        const u = USERS.find((x) => x.email === b.email && x.password === b.password);
        return u ? send(res, 200, session(u)) : send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials' });
      }
      if (url.pathname === '/auth/v1/user') {
        const id = identity(req);
        const u = id?.role === 'authenticated' ? USERS.find((x) => x.id === id.claims.sub) : null;
        return u ? send(res, 200, userJson(u)) : send(res, 401, { message: 'invalid JWT', code: 'bad_jwt' });
      }
      if (url.pathname === '/auth/v1/logout') return send(res, 204);

      if (url.pathname.startsWith('/rest/v1/')) {
        const body = raw.length ? JSON.parse(raw.toString()) : undefined;
        const out = await rest(req, url, body);
        const headers = {};
        if (out.total !== undefined && out.total !== null) {
          const n = Array.isArray(out.json) ? out.json.length : 0;
          headers['content-range'] = n ? `${out.from}-${out.from + n - 1}/${out.total}` : `*/${out.total}`;
        }
        if (out.single) {
          const list = out.json ?? [];
          if (list.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${list.length} rows`, hint: null });
          return send(res, out.status, list[0], headers);
        }
        return send(res, out.status, out.json, headers);
      }

      if (url.pathname.startsWith('/storage/v1/')) {
        const out = await storage(req, url, raw);
        if (out.object === undefined && 'object' in out) return send(res, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
        if (out.object) {
          let bytes = out.object.bytes;
          const range = String(req.headers.range ?? '').match(/^bytes=(\d+)-(\d+)?$/);
          let status = 200;
          if (range) {
            bytes = bytes.subarray(Number(range[1]), range[2] ? Number(range[2]) + 1 : undefined);
            status = 206;
          }
          const headers = { 'content-type': out.object.contentType, 'content-length': String(bytes.length), ...CORS };
          if (out.download !== null && out.download !== undefined) headers['content-disposition'] = `attachment; filename="${out.download || 'file'}"`;
          res.writeHead(status, headers);
          return res.end(bytes);
        }
        return send(res, 200, out.json);
      }
      return send(res, 404, { message: 'not stubbed' });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, e.body);
      console.error('mini-supabase error', e?.message);
      return send(res, 500, { message: 'stub error' });
    }
  });
});

await setupDatabase();
server.listen(PORT, '127.0.0.1', () => console.log(`mini-supabase on ${PORT} (db ${E2E_DB})`));
