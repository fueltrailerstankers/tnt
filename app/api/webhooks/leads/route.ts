import { appEnv } from '@/lib/env';
import { intakeEventKey, MAX_BODY_BYTES, secretMatches, usableSecret } from '@/lib/leads/intake';
import { IntakePayload, WEBHOOK_SOURCES } from '@/lib/leads/schema';
import { createLead } from '@/lib/leads/service';
import { clientIp, rateLimit } from '@/lib/security/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';

// Lead intake (M4): test and website sources. Shared secret in x-leads-secret (constant-time compare),
// rate limited per client, raw body stored first in integration_events keyed by sha256(source:source_id),
// so a repeated post is a no-op that answers 200 { duplicate: true }. Then the lead is created, routed,
// matched and ONE notification is sent. Responses and logs never echo personal data.
export const dynamic = 'force-dynamic';

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

export async function POST(req: Request) {
  if (!rateLimit(`leads-intake:${clientIp(req.headers)}`, 60, 60_000)) return json(429, { error: 'rate limited' });

  const secret = usableSecret(process.env.LEADS_WEBHOOK_SECRET);
  if (!secret) return json(503, { error: 'lead intake is not configured' });
  if (!secretMatches(req.headers.get('x-leads-secret'), secret)) return json(401, { error: 'unauthorized' });

  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json(413, { error: 'payload too large' });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid JSON' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'expected a JSON object' });
  const { source, source_id: sourceId } = body as { source?: unknown; source_id?: unknown };
  if (typeof source !== 'string' || !(WEBHOOK_SOURCES as readonly string[]).includes(source)) return json(400, { error: 'unsupported source' });
  if (typeof sourceId !== 'string' || !sourceId.trim() || sourceId.length > 200) return json(400, { error: 'source_id is required' });

  const orgId = appEnv().PUBLIC_ORG_ID;
  const db = createAdminClient();
  const externalId = intakeEventKey(source, sourceId.trim());

  // Raw first. A replay hits the unique (source, external_id) index.
  let eventId: string;
  const { data: stored, error } = await db.from('integration_events')
    .insert({ org_id: orgId, source: 'leads', external_id: externalId, signature_ok: true, payload: body, status: 'received' })
    .select('id').single();
  if (error) {
    if (error.code !== '23505' && !/duplicate/i.test(error.message)) return json(500, { error: 'could not store event' });
    const { data: prior } = await db.from('integration_events').select('id, status').eq('source', 'leads').eq('external_id', externalId).single();
    if (!prior) return json(500, { error: 'could not store event' });
    if (prior.status === 'processed' || prior.status === 'ignored') return json(200, { ok: true, duplicate: true });
    eventId = prior.id; // stored earlier but not processed (e.g. a crash): finish it; the lead itself is idempotent
  } else {
    eventId = stored.id;
  }

  const parsed = IntakePayload.safeParse(body);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))];
    await db.from('integration_events').update({ status: 'ignored', error: `invalid: ${fields.join(',')}`.slice(0, 200), processed_at: new Date().toISOString() }).eq('id', eventId);
    return json(400, { error: 'invalid payload', fields });
  }
  const p = parsed.data;

  try {
    const r = await createLead(db, orgId, {
      source: p.source, source_form: p.form ?? null, external_id: p.source_id,
      name: p.name, email: p.email, phone: p.phone, product: p.product, message: p.message, branch: p.branch,
      gclid: p.gclid, fbclid: p.fbclid, utm: p.utm ?? null, raw: body,
    }, { actor: null, notify: true });
    await db.from('integration_events').update({ status: 'processed', attempts: 1, error: null, processed_at: new Date().toISOString() }).eq('id', eventId);
    return json(200, { ok: true, duplicate: !r.created });
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : 'failed';
    await db.from('integration_events').update({ status: 'failed', attempts: 1, error: msg }).eq('id', eventId);
    return json(500, { error: 'could not process lead' });
  }
}
