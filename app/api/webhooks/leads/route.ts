import { after } from 'next/server';
import { appEnv } from '@/lib/env';
import { drainOutbox } from '@/lib/jobs/handlers';
import { enqueue } from '@/lib/jobs/outbox';
import {
  declaredTooLarge, intakeEventKey, invalidFields, MAX_BODY_BYTES, priorEventAction, secretMatches, usableSecret,
} from '@/lib/leads/intake';
import { IntakePayload, WEBHOOK_SOURCES } from '@/lib/leads/schema';
import { clientIp, rateLimit } from '@/lib/security/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';

// Lead intake (M4): test and website sources. Shared secret in x-leads-secret (constant-time compare),
// rate limited per client, body size capped before and after reading. Then: validate, store the raw body in
// integration_events keyed by sha256(source:source_id) (`received`, or `ignored` with field names when invalid),
// enqueue an outbox job `leads.intake` ({ event_id }) and answer 200 fast. The job (lib/leads/intake-job.ts)
// creates, routes, matches and notifies, resumably and at most once. A repeated post is a no-op that answers
// 200 { duplicate: true }, except: an invalid body answers 400 and never touches the stored row; a valid body
// replaces a stored row that never became a lead (`ignored` or `received`) and is queued; a `failed` row is
// claimed (failed -> queued) and queued again. Responses and logs never echo personal data.
export const dynamic = 'force-dynamic';

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

export async function POST(req: Request) {
  if (!rateLimit(`leads-intake:${clientIp(req.headers)}`, 60, 60_000)) return json(429, { error: 'rate limited' });

  const secret = usableSecret(process.env.LEADS_WEBHOOK_SECRET);
  if (!secret) return json(503, { error: 'lead intake is not configured' });
  if (!secretMatches(req.headers.get('x-leads-secret'), secret)) return json(401, { error: 'unauthorized' });

  if (declaredTooLarge(req.headers.get('content-length'))) return json(413, { error: 'payload too large' });
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

  // Validate before writing anything: an invalid body is stored once as `ignored`, but never replaces a stored row.
  const parsed = IntakePayload.safeParse(body);
  const fields = parsed.success ? [] : invalidFields(parsed.error.issues);
  const invalid = () => json(400, { error: 'invalid payload', fields });

  // Raw first. A replay hits the unique (source, external_id) index.
  let eventId: string;
  const { data: stored, error } = await db.from('integration_events')
    .insert({
      org_id: orgId, source: 'leads', external_id: externalId, signature_ok: true, payload: body,
      ...(parsed.success
        ? { status: 'received' }
        : { status: 'ignored', error: `invalid: ${fields.join(',')}`.slice(0, 200), processed_at: new Date().toISOString() }),
    })
    .select('id').single();
  if (error) {
    if (error.code !== '23505' && !/duplicate/i.test(error.message)) return json(500, { error: 'could not store event' });
    if (!parsed.success) return invalid(); // the stored row (maybe a lead already) stays as it is
    const { data: prior, error: readError } = await db.from('integration_events').select('id, status').eq('source', 'leads').eq('external_id', externalId).single();
    if (readError || !prior) return json(500, { error: 'could not store event' });
    const action = priorEventAction(prior.status as string);
    if (action === 'duplicate') return json(200, { ok: true, duplicate: true });
    if (action === 'requeue') {
      // Processing failed earlier: claim the row (failed -> queued) so only one post queues it again; the lead
      // service finishes the missing stages.
      const { data: claimed, error: claimError } = await db.from('integration_events')
        .update({ status: 'queued', error: null }).eq('id', prior.id).eq('status', 'failed').select('id');
      if (claimError) return json(500, { error: 'could not queue event' });
      if (!claimed?.length) return json(200, { ok: true, duplicate: true }); // a concurrent post or the job took it
      try {
        await enqueue(db, orgId, 'leads.intake', { event_id: prior.id });
      } catch {
        await db.from('integration_events').update({ status: 'failed', error: 'could not queue the retry' }).eq('id', prior.id).eq('status', 'queued');
        return json(500, { error: 'could not queue event' });
      }
      drainSoon();
      return json(200, { ok: true, duplicate: true });
    }
    // The stored body never became a lead (invalid, or never queued): this valid post replaces it.
    const { data: took, error: replaceError } = await db.from('integration_events')
      .update({ payload: body, status: 'received', error: null, processed_at: null, received_at: new Date().toISOString() })
      .eq('id', prior.id).in('status', ['ignored', 'received']).select('id');
    if (replaceError) return json(500, { error: 'could not store event' });
    if (!took?.length) return json(200, { ok: true, duplicate: true }); // a concurrent post took it
    eventId = prior.id;
  } else {
    if (!parsed.success) return invalid();
    eventId = stored.id;
  }

  if (!(await queue(db, orgId, eventId))) return json(500, { error: 'could not queue event' });
  drainSoon();
  return json(200, { ok: true, duplicate: false });
}

/** Runs queued jobs after the response is sent, as the Xero webhook does; the scheduler is the backstop. */
function drainSoon() {
  after(() => drainOutbox(createAdminClient(), 20_000).then(() => undefined, () => undefined));
}

/**
 * Enqueues the intake job, then marks the event queued. False when the job could not be stored. The status write
 * applies only while the event is still `received`: a job that already ran (processed, failed, ignored) wins.
 */
async function queue(db: ReturnType<typeof createAdminClient>, orgId: string, eventId: string): Promise<boolean> {
  try {
    await enqueue(db, orgId, 'leads.intake', { event_id: eventId });
  } catch {
    return false; // the event stays received: a retry of the same source_id replaces and queues it
  }
  await db.from('integration_events').update({ status: 'queued', error: null }).eq('id', eventId).eq('status', 'received');
  return true;
}
