// Minimal stand-in for Supabase Auth + PostgREST, used only by the Playwright smoke tests.
// All identities are synthetic. This proves the app's own login and guard logic, not Supabase itself.
import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT ?? 54399);
export const USER = { id: '00000000-0000-0000-0000-00000000a001', email: 'admin@example.invalid', password: 'correct-horse-battery' };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', aud: 'authenticated', exp })}.stub`;
}
const user = () => ({ id: USER.id, aud: 'authenticated', role: 'authenticated', email: USER.email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });

const rows = {
  memberships: [{ org_id: '00000000-0000-0000-0000-000000000001', role: 'admin', branch: null }],
  orgs: [{ name: 'Trailers & Tankers', currency_code: 'USD', timezone: 'Africa/Johannesburg' }],
  forms: Array.from({ length: 7 }, (_, i) => ({ id: String(i) })),
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://stub');
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
      const b = JSON.parse(raw || '{}');
      if (b.email === USER.email && b.password === USER.password) {
        return send(res, 200, { access_token: jwt(), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub-refresh', user: user() });
      }
      return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
    }
    if (url.pathname === '/auth/v1/user') {
      return (req.headers.authorization ?? '').startsWith('Bearer ey') ? send(res, 200, user()) : send(res, 401, { message: 'unauthorized' });
    }
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    if (url.pathname === '/auth/v1/logout') return send(res, 204);
    const m = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (m && rows[m[1]]) {
      const list = rows[m[1]];
      const range = { 'content-range': `0-${Math.max(list.length - 1, 0)}/${list.length}` };
      if (req.method === 'HEAD') return send(res, 200, undefined, range);
      const single = (req.headers.accept ?? '').includes('vnd.pgrst.object');
      return send(res, 200, single ? list[0] : list, range);
    }
    return send(res, 404, { message: 'not stubbed' });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`stub supabase on ${PORT}`));
