// Test-only mock of Xero (login, identity, connections, Accounting API GETs). Never deployed. No dependencies.
// Every name, number, id and amount here is synthetic.
//
//   GET  /identity/connect/authorize   consent: redirects to redirect_uri with code + the same state
//   POST /connect/token                authorization_code and refresh_token grants (Basic auth; single-use rotating
//                                      refresh tokens)
//   GET  /connections                  one ORGANISATION tenant
//   GET  /api.xro/2.0/...              Contacts, Quotes, Invoices, Payments (+ /{id}, Invoices/{id}/Attachments)
//   Any non-GET to /api.xro/ -> 405, and it is logged so the no-writes test can see it.
//
// Test controls: GET /__health, GET /__log, GET /__data, POST /__reset, POST /__expire-access-token, POST /__mutate.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.XERO_PORT ?? process.env.E2E_XERO_PORT ?? 54599);
export const CLIENT_ID = 'e2e-xero-client-id';
export const CLIENT_SECRET = 'e2e-xero-client-secret-not-real';
export const TENANT = { tenantId: '5e7e0000-0000-4000-8000-00000000c0de', tenantName: 'Synthetic Trailers (Pty) Ltd' };
const ACCESS_TTL_S = 1800;

// ---------------------------------------------------------------------------------------------------
// Synthetic data
// ---------------------------------------------------------------------------------------------------
const uuid = (kind, n) => `${kind}-0000-4000-8000-${String(n).padStart(12, '0')}`; // kind: 8 hex chars
const netDate = (iso) => `/Date(${Date.parse(iso)}+0000)/`;
const isoDay = (iso) => `${iso.slice(0, 10)}T00:00:00`;
const r2 = (n) => Math.round(n * 100) / 100;

function buildData() {
  const contacts = [1, 2, 3].map((n) => ({
    ContactID: uuid('c0000000', n),
    Name: `Synthetic Customer ${n}`,
    FirstName: 'Test',
    LastName: `Customer${n}`,
    EmailAddress: `customer${n}@example.invalid`,
    ContactStatus: 'ACTIVE',
    IsCustomer: true,
    UpdatedDateUTC: netDate(`2026-09-0${n}T08:00:00Z`),
  }));
  const contactRef = (n) => ({ ContactID: contacts[n - 1].ContactID, Name: contacts[n - 1].Name });

  const lineItems = (amounts, prefix) => amounts.map((a, i) => ({
    LineItemID: uuid(prefix, i + 1),
    ItemCode: `SYN-${i + 1}`,
    Description: `Synthetic trailer part ${i + 1}`,
    Quantity: 1,
    UnitAmount: a,
    LineAmount: a,
    TaxAmount: r2(a * 0.15),
  }));
  const totals = (lines) => {
    const sub = r2(lines.reduce((s, l) => s + l.LineAmount, 0));
    const tax = r2(lines.reduce((s, l) => s + l.TaxAmount, 0));
    return { SubTotal: sub, TotalTax: tax, Total: r2(sub + tax) };
  };

  // Quotes: five in September 2026 (with lines), one old open quote from 2024.
  const quotes = [];
  const quoteSpecs = [
    { no: '0101', date: '2026-09-03', status: 'ACCEPTED', amounts: [10000, 2500.5] },
    { no: '0102', date: '2026-09-08', status: 'SENT', amounts: [4200] },
    { no: '0103', date: '2026-09-15', status: 'DRAFT', amounts: [880.25, 120] },
    { no: '0104', date: '2026-09-22', status: 'INVOICED', amounts: [15000] },
    { no: '0105', date: '2026-09-29', status: 'DECLINED', amounts: [999.99] },
    { no: '0042', date: '2024-10-10', status: 'ACCEPTED', amounts: [3000], updated: '2024-10-10T09:00:00Z' },
  ];
  quoteSpecs.forEach((q, i) => {
    const lines = lineItems(q.amounts, `a${String(i + 1).padStart(7, '0')}`);
    quotes.push({
      QuoteID: uuid('a0000000', i + 1),
      QuoteNumber: `QU-${q.no}`,
      Reference: `Synthetic quote ${q.no}`,
      Status: q.status,
      Contact: contactRef((i % 3) + 1),
      Date: netDate(`${q.date}T00:00:00Z`),
      DateString: isoDay(q.date),
      ExpiryDate: netDate(`${q.date}T00:00:00Z`),
      CurrencyCode: 'ZAR',
      LineAmountTypes: 'EXCLUSIVE',
      LineItems: lines,
      ...totals(lines),
      UpdatedDateUTC: netDate(q.updated ?? `${q.date}T10:00:00Z`),
    });
  });

  // Invoices: 230 in Aug/Sep 2026 (more than one 200-row page), the deal-file invoice, one with attachments,
  // one old open invoice (2024, only reachable by the open-status backfill pass) and one old paid invoice
  // (2024, must NOT be mirrored).
  const invoices = [];
  const inv = (n, o) => {
    const lines = lineItems(o.amounts, `b${String(n).padStart(7, '0')}`);
    const t = totals(lines);
    const paid = o.status === 'PAID';
    invoices.push({
      Type: o.type ?? 'ACCREC',
      InvoiceID: uuid('b0000000', n),
      InvoiceNumber: o.number ?? `INV-${String(1000 + n)}`,
      Reference: o.reference ?? '',
      Status: o.status,
      Contact: contactRef((n % 3) + 1),
      Date: netDate(`${o.date}T00:00:00Z`),
      DateString: isoDay(o.date),
      DueDate: netDate(`${o.date}T00:00:00Z`),
      DueDateString: isoDay(o.date),
      CurrencyCode: 'ZAR',
      LineAmountTypes: 'EXCLUSIVE',
      LineItems: lines,
      ...t,
      AmountDue: paid ? 0 : t.Total,
      AmountPaid: paid ? t.Total : 0,
      AmountCredited: 0,
      ...(paid ? { FullyPaidOnDate: netDate(`${o.date}T00:00:00Z`) } : {}),
      HasAttachments: !!o.attachments,
      UpdatedDateUTC: netDate(o.updated ?? `${o.date}T12:00:00Z`),
    });
  };
  for (let n = 1; n <= 230; n++) {
    const month = n % 2 ? '09' : '08';
    const day = String((n % 28) + 1).padStart(2, '0');
    inv(n, { date: `2026-${month}-${day}`, status: n % 5 === 0 ? 'PAID' : 'AUTHORISED', amounts: [100 + n * 3.17], type: n % 23 === 0 ? 'ACCPAY' : 'ACCREC' });
  }
  inv(231, { number: 'INV-9001', reference: '0101', date: '2026-09-10', status: 'AUTHORISED', amounts: [10000, 2500.5] });
  inv(232, { number: 'INV-9002', reference: 'Synthetic attachments', date: '2026-09-11', status: 'AUTHORISED', amounts: [500], attachments: true });
  inv(233, { number: 'INV-0420', reference: 'Old open', date: '2024-11-15', status: 'AUTHORISED', amounts: [750], updated: '2024-11-15T12:00:00Z' });
  inv(234, { number: 'INV-0421', reference: 'Old paid', date: '2024-11-16', status: 'PAID', amounts: [640], updated: '2024-11-16T12:00:00Z' });

  const attachments = {
    [uuid('b0000000', 232)]: [1, 2].map((n) => ({
      AttachmentID: uuid('d0000000', n),
      FileName: `synthetic-${n}.pdf`,
      Url: `https://api.xero.invalid/attachments/${n}`,
      MimeType: 'application/pdf',
      ContentLength: 1000 * n,
    })),
  };

  // Payments against some paid invoices, dated in September 2026.
  const payments = invoices
    .filter((i) => i.Status === 'PAID' && i.Type === 'ACCREC' && i.DateString.startsWith('2026-09'))
    .slice(0, 12)
    .map((i, k) => ({
      PaymentID: uuid('e0000000', k + 1),
      Date: i.Date,
      Amount: i.Total,
      Reference: `Synthetic EFT ${k + 1}`,
      Status: 'AUTHORISED',
      PaymentType: 'ACCRECPAYMENT',
      CurrencyRate: 1,
      UpdatedDateUTC: i.UpdatedDateUTC,
      Invoice: { InvoiceID: i.InvoiceID, InvoiceNumber: i.InvoiceNumber, CurrencyCode: i.CurrencyCode },
    }));

  return { contacts, quotes, invoices, payments, attachments };
}

// ---------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------
let data;
let log;
let codes; // code -> { redirect_uri, exp }
let accessTokens; // token -> exp (ms)
let refreshTokens; // token -> true (single use)
let apiCalls;

function reset() {
  data = buildData();
  log = [];
  codes = new Map();
  accessTokens = new Map();
  refreshTokens = new Set();
  apiCalls = 0;
}
reset();

const token = (kind) => `mock-${kind}-${randomBytes(18).toString('hex')}`;

function issueTokens() {
  const access = token('at');
  const refresh = token('rt');
  accessTokens.set(access, Date.now() + ACCESS_TTL_S * 1000);
  refreshTokens.add(refresh);
  return { access_token: access, refresh_token: refresh, expires_in: ACCESS_TTL_S, token_type: 'Bearer', scope: 'offline_access accounting.transactions.read accounting.contacts.read accounting.attachments.read' };
}

function bearerOk(req) {
  const t = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const exp = accessTokens.get(t);
  return !!exp && exp > Date.now();
}

function basicOk(req) {
  const m = String(req.headers.authorization ?? '').match(/^Basic\s+(.+)$/i);
  if (!m) return false;
  const given = Buffer.from(m[1], 'base64');
  const want = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

// ---------------------------------------------------------------------------------------------------
// Accounting API helpers
// ---------------------------------------------------------------------------------------------------
const msOf = (net) => Number(String(net).match(/-?\d+/)[0]);

class Bad extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

/** The subset of Xero's `where` the app sends: Date >= DateTime(y, m, d) && Date < DateTime(y, m, d). */
function whereFilter(w) {
  if (!w) return () => true;
  const m = w.match(/^\s*Date\s*>=\s*DateTime\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)\s*&&\s*Date\s*<\s*DateTime\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)\s*$/);
  if (!m) throw new Bad(400, 'unsupported where');
  const from = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const to = Date.UTC(+m[4], +m[5] - 1, +m[6]);
  return (r) => msOf(r.Date) >= from && msOf(r.Date) < to;
}

function list(req, url, key, rows, { pageSizeParam, statusParam, dateRange }) {
  let out = rows;
  const ims = req.headers['if-modified-since'];
  if (ims) {
    const since = Date.parse(String(ims));
    if (Number.isNaN(since)) throw new Bad(400, 'bad If-Modified-Since');
    out = out.filter((r) => msOf(r.UpdatedDateUTC) >= since);
  }
  const statuses = url.searchParams.get('Statuses');
  if (statuses) {
    const set = new Set(statuses.split(','));
    out = out.filter((r) => set.has(r.Status));
  }
  const status = statusParam ? url.searchParams.get('Status') : null;
  if (status) out = out.filter((r) => r.Status === status);
  if (dateRange) {
    const from = url.searchParams.get('DateFrom');
    const to = url.searchParams.get('DateTo');
    if (from) out = out.filter((r) => r.DateString.slice(0, 10) >= from);
    if (to) out = out.filter((r) => r.DateString.slice(0, 10) <= to);
  }
  out = out.filter(whereFilter(url.searchParams.get('where')));
  const page = url.searchParams.get('page');
  if (page) {
    const p = Number(page);
    if (!Number.isInteger(p) || p < 1) throw new Bad(400, 'bad page');
    const raw = pageSizeParam ? url.searchParams.get('pageSize') : null;
    const size = raw ? Math.min(Number(raw), 1000) : 100;
    out = out.slice((p - 1) * size, p * size);
  }
  return { [key]: out };
}

function api(req, url) {
  const p = url.pathname.replace(/^\/api\.xro\/2\.0/, '');
  let m;
  if (p === '/Contacts') return list(req, url, 'Contacts', data.contacts, { pageSizeParam: true });
  if (p === '/Quotes') return list(req, url, 'Quotes', data.quotes, { statusParam: true, dateRange: true });
  if (p === '/Invoices') return list(req, url, 'Invoices', data.invoices, { pageSizeParam: true });
  if (p === '/Payments') return list(req, url, 'Payments', data.payments, { pageSizeParam: true });
  if ((m = p.match(/^\/Invoices\/([0-9a-f-]{36})\/Attachments$/))) {
    if (!data.invoices.some((i) => i.InvoiceID === m[1])) throw new Bad(404, 'not found');
    return { Attachments: data.attachments[m[1]] ?? [] };
  }
  if ((m = p.match(/^\/Invoices\/([0-9a-f-]{36})$/))) {
    const i = data.invoices.find((x) => x.InvoiceID === m[1]);
    if (!i) throw new Bad(404, 'not found');
    return { Invoices: [i] };
  }
  if ((m = p.match(/^\/Contacts\/([0-9a-f-]{36})$/))) {
    const c = data.contacts.find((x) => x.ContactID === m[1]);
    if (!c) throw new Bad(404, 'not found');
    return { Contacts: [c] };
  }
  throw new Bad(404, 'not mocked');
}

/** Test control: change a record the way Xero would (new UpdatedDateUTC). */
function mutate(b) {
  if (b.invoiceId || b.invoiceNumber) {
    const i = data.invoices.find((x) => x.InvoiceID === b.invoiceId || x.InvoiceNumber === b.invoiceNumber);
    if (!i) throw new Bad(404, 'no such invoice');
    if (b.status === 'PAID') {
      i.Status = 'PAID';
      i.AmountPaid = i.Total;
      i.AmountDue = 0;
      i.FullyPaidOnDate = netDate(new Date().toISOString());
    } else if (b.status) i.Status = b.status;
    i.UpdatedDateUTC = netDate(new Date().toISOString());
    return { Invoices: [i] };
  }
  throw new Bad(400, 'nothing to mutate');
}

// ---------------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString();
    const url = new URL(req.url, 'http://mock-xero');
    const isApi = url.pathname.startsWith('/api.xro/');
    try {
      // Test controls (not logged).
      if (url.pathname === '/__health') return send(res, 200, { ok: true });
      if (url.pathname === '/__log' && req.method === 'GET') return send(res, 200, log);
      if (url.pathname === '/__data' && req.method === 'GET') return send(res, 200, { tenant: TENANT, ...data });
      if (url.pathname === '/__reset' && req.method === 'POST') { reset(); return send(res, 200, { ok: true }); }
      if (url.pathname === '/__expire-access-token' && req.method === 'POST') {
        for (const k of accessTokens.keys()) accessTokens.set(k, 0);
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/__mutate' && req.method === 'POST') return send(res, 200, mutate(JSON.parse(raw || '{}')));

      const entry = { method: req.method, path: url.pathname, api: isApi };
      log.push(entry);

      if (isApi) {
        if (req.method !== 'GET') return send(res, 405, { Type: 'MethodNotAllowed', Message: 'This mock is read-only' });
        if (!bearerOk(req)) return send(res, 401, { Type: 'Unauthorized', Title: 'Unauthorized', Status: 401, Detail: 'TokenExpired' });
        if (req.headers['xero-tenant-id'] !== TENANT.tenantId) return send(res, 403, { Type: 'Forbidden', Title: 'Forbidden', Status: 403 });
        apiCalls += 1;
        const rate = { 'x-minlimit-remaining': '58', 'x-daylimit-remaining': String(Math.max(0, 4990 - apiCalls)), 'x-appminlimit-remaining': '9990' };
        try {
          return send(res, 200, api(req, url), rate);
        } catch (e) {
          if (e instanceof Bad) return send(res, e.status, { Message: e.message }, rate);
          throw e;
        }
      }

      if (url.pathname === '/identity/connect/authorize' && req.method === 'GET') {
        const q = url.searchParams;
        if (q.get('client_id') !== CLIENT_ID || q.get('response_type') !== 'code' || !q.get('redirect_uri')) return send(res, 400, { error: 'invalid_request' });
        const code = token('code');
        codes.set(code, { redirect_uri: q.get('redirect_uri'), exp: Date.now() + 5 * 60_000 });
        const back = new URL(q.get('redirect_uri'));
        back.searchParams.set('code', code);
        back.searchParams.set('scope', q.get('scope') ?? '');
        if (q.get('state')) back.searchParams.set('state', q.get('state'));
        res.writeHead(302, { location: back.toString() });
        return res.end();
      }

      if (url.pathname === '/connect/token' && req.method === 'POST') {
        if (!basicOk(req)) return send(res, 401, { error: 'invalid_client' });
        const b = new URLSearchParams(raw);
        entry.grant = b.get('grant_type');
        if (b.get('grant_type') === 'authorization_code') {
          const c = codes.get(b.get('code') ?? '');
          codes.delete(b.get('code') ?? '');
          if (!c || c.exp < Date.now() || c.redirect_uri !== b.get('redirect_uri')) return send(res, 400, { error: 'invalid_grant' });
          return send(res, 200, issueTokens());
        }
        if (b.get('grant_type') === 'refresh_token') {
          const rt = b.get('refresh_token') ?? '';
          if (!refreshTokens.delete(rt)) return send(res, 400, { error: 'invalid_grant' });
          return send(res, 200, issueTokens());
        }
        return send(res, 400, { error: 'unsupported_grant_type' });
      }

      if (url.pathname === '/connections' && req.method === 'GET') {
        if (!bearerOk(req)) return send(res, 401, { error: 'unauthorized' });
        return send(res, 200, [{
          id: '5e7e0000-0000-4000-8000-0000000000c1', authEventId: '5e7e0000-0000-4000-8000-0000000000e1',
          tenantId: TENANT.tenantId, tenantType: 'ORGANISATION', tenantName: TENANT.tenantName,
          createdDateUtc: '2026-01-01T00:00:00.0000000', updatedDateUtc: '2026-01-01T00:00:00.0000000',
        }]);
      }
      return send(res, 404, { error: 'not mocked' });
    } catch (e) {
      if (e instanceof Bad) return send(res, e.status, { error: e.message });
      console.error('mock-xero error', e?.message);
      return send(res, 500, { error: 'mock error' });
    }
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock-xero on ${PORT}`));
