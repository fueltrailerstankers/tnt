import { after } from 'next/server';
import { webhookKey } from '@/lib/integrations/xero/config';
import { entityFor, eventKey, Payload, verifySignature } from '@/lib/integrations/xero/webhook';
import { drainOutbox } from '@/lib/jobs/handlers';
import { enqueue } from '@/lib/jobs/outbox';
import { createAdminClient } from '@/lib/supabase/admin';

// Xero webhook receiver: verify the signature over the raw body, store each event raw, queue a fetch,
// answer 200 fast (Xero allows 5 s). A replayed event has the same key and is a no-op. Invalid signatures
// get 401 and nothing is stored (that is also how Xero's intent-to-receive check works).
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const raw = await req.text();
  const key = webhookKey();
  if (!key || !verifySignature(raw, req.headers.get('x-xero-signature'), key)) return new Response(null, { status: 401 });

  let payload;
  try {
    payload = Payload.parse(JSON.parse(raw));
  } catch {
    return new Response(null, { status: 200 }); // signed but not understood: acknowledge, nothing to do
  }
  if (!payload.events.length) return new Response(null, { status: 200 }); // intent to receive

  const db = createAdminClient();
  const { data: conns } = await db.from('xero_connections').select('org_id, tenant_id').eq('status', 'connected');
  const orgFor = new Map((conns ?? []).map((c) => [c.tenant_id as string, c.org_id as string]));
  let queued = 0;

  for (const e of payload.events) {
    const orgId = orgFor.get(e.tenantId) ?? null;
    const entity = entityFor(e);
    const { data: stored, error } = await db
      .from('integration_events')
      .insert({ org_id: orgId, source: 'xero', external_id: eventKey(e), signature_ok: true, payload: e, status: orgId && entity ? 'queued' : 'ignored' })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505' || /duplicate/i.test(error.message)) continue; // replay: already stored
      return new Response(null, { status: 500 }); // Xero retries
    }
    if (orgId && entity) {
      await enqueue(db, orgId, 'xero.fetch', { entity, id: e.resourceId, event_id: stored.id });
      queued += 1;
    }
  }
  if (queued) after(() => drainOutbox(createAdminClient(), 20_000).then(() => undefined, () => undefined));
  return new Response(null, { status: 200 });
}
