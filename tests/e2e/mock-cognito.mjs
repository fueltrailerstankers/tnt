// Test-only mock of the Cognito Forms REST API, shaped by the assumptions in docs/M5.md (A1, A2, A4..A6, A14).
// Never deployed. No dependencies. Every name, number, id and file here is synthetic.
//
//   GET /api/forms                          the organisation's forms (A14): three platform forms + one that is not
//   GET /api/forms/{id}/entries/{number}    one entry (A2), 404 when the number does not exist
//   GET /api/files/{id}                     file bytes (A6)
//   Every /api/* call needs "Authorization: Bearer <KEY>", else 401.
//
// Test controls: GET /__health, GET /__log, POST /__reset, POST /__seed {"base": 10} (entry numbers start after
// base, so imports never clash with entries other specs created), POST /__delay {"ms": 100} (slow every API call).
import { createServer } from 'node:http';

const PORT = Number(process.env.COGNITO_PORT ?? process.env.E2E_COGNITO_PORT ?? 54598);
export const KEY = 'e2e-cognito-key-not-real-0123';

// A minimal valid PDF (magic bytes %PDF-).
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

let base = 0;
let delayMs = 0;
let log = [];

const origin = () => `http://127.0.0.1:${PORT}/api`;

const FORMS = [
  { Id: '4', Name: 'Request For Invoice', InternalName: 'RequestForInvoice' },
  { Id: '8', Name: 'RELEASE FORM', InternalName: 'RELEASEFORM', EntryCount: 0 },
  { Id: '12', Name: 'STORE ROOM', InternalName: 'STOREROOM' },
  { Id: '77', Name: 'Synthetic Feedback Survey', InternalName: 'SyntheticFeedbackSurvey', EntryCount: 3 },
];

/** Request for invoice entries, numbered base+1.. (base+3 was "deleted": 404). */
function rfiEntries() {
  const n = (i) => base + i;
  const meta = (i, status, day) => ({
    Number: n(i), Status: status, DateCreated: `2026-01-0${day}T08:00:00Z`, DateSubmitted: status === 'Submitted' ? `2026-01-0${day}T08:01:00Z` : null,
    DateUpdated: `2026-01-0${day}T09:00:00Z`, Version: 1,
  });
  const form = { Id: '4', InternalName: 'RequestForInvoice', Name: 'Request For Invoice' };
  return {
    [n(1)]: {
      Id: `4-${n(1)}`, Form: form, QuoteNo: 'QU-E2E-0001', DATE: '2026-01-05', SalesRep: 'Synthetic Rep',
      Name: { First: 'Testy', Last: 'Importperson' }, IDNO: 'FAKE-ID-E2E-0001',
      _1stDeposit: [{ Id: 'F-e2e-1', Name: 'synthetic-deposit.pdf', ContentType: 'application/pdf', Size: PDF.length, File: `${origin()}/files/F-e2e-1` }],
      Entry: meta(1, 'Submitted', 5),
    },
    [n(2)]: {
      Id: `4-${n(2)}`, Form: form, QuoteNo: 'QU-E2E-0002', DATE: '2026-01-06', SalesRep: 'Synthetic Rep',
      Name: { First: 'Sample', Last: 'Importnobody' }, Entry: meta(2, 'Submitted', 6),
    },
    [n(4)]: {
      Id: `4-${n(4)}`, Form: form, QuoteNo: 'QU-E2E-0004', Name: { First: 'Skipped', Last: 'Fakestatus' }, Entry: meta(4, 'Archived Somehow', 8),
    },
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

async function api(req, res, url) {
  const authed = req.headers.authorization === `Bearer ${KEY}`;
  log.push({ method: req.method, path: url.pathname, authed });
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  if (!authed) return send(res, 401, { Message: 'Authorization has been denied for this request.' });
  if (req.method !== 'GET') return send(res, 405, { Message: 'read only mock' });
  const p = url.pathname.replace(/^\/api/, '');
  let m;
  if (p === '/forms') return send(res, 200, FORMS);
  if ((m = p.match(/^\/forms\/(\d+)\/entries\/(\d+)$/))) {
    const entry = m[1] === '4' ? rfiEntries()[Number(m[2])] : undefined;
    return entry ? send(res, 200, entry) : send(res, 404, { Message: 'Entry not found' });
  }
  if ((m = p.match(/^\/files\/([A-Za-z0-9-]+)$/))) {
    if (m[1] !== 'F-e2e-1') return send(res, 404, { Message: 'File not found' });
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': String(PDF.length) });
    return res.end(PDF);
  }
  return send(res, 404, { Message: 'not mocked' });
}

const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const raw = Buffer.concat(chunks).toString();
    const url = new URL(req.url, 'http://mock-cognito');
    try {
      if (url.pathname === '/__health') return send(res, 200, { ok: true });
      if (url.pathname === '/__log') return send(res, 200, log);
      if (url.pathname === '/__reset' && req.method === 'POST') {
        base = 0;
        delayMs = 0;
        log = [];
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/__seed' && req.method === 'POST') {
        const b = JSON.parse(raw || '{}');
        base = Number.isInteger(b.base) && b.base >= 0 ? b.base : 0;
        return send(res, 200, { ok: true, base });
      }
      if (url.pathname === '/__delay' && req.method === 'POST') {
        const b = JSON.parse(raw || '{}');
        delayMs = Number.isInteger(b.ms) && b.ms >= 0 ? b.ms : 0;
        return send(res, 200, { ok: true, delayMs });
      }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      return send(res, 404, { Message: 'not mocked' });
    } catch {
      return send(res, 500, { Message: 'mock error' });
    }
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock-cognito on ${PORT}`));
