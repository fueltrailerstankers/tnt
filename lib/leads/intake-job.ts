import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invalidFields } from './intake';
import { IntakePayload } from './schema';
import { createLead } from './service';

// Outbox job `leads.intake` ({ event_id }): turns a stored raw intake event into a lead. Idempotent and
// replayable: createLead resumes a partly processed lead and never sends its notification twice.
// The event ends `processed`, `ignored` (payload invalid) or `failed` (the error is rethrown so the outbox
// retries with backoff). Errors and logs hold field names and ids only.

export type IntakeOutcome = 'processed' | 'ignored' | 'skipped';

export async function processLeadEvent(db: SupabaseClient, orgId: string, eventId: string): Promise<IntakeOutcome> {
  const { data: ev, error } = await db.from('integration_events').select('id, payload, status, attempts')
    .eq('id', eventId).eq('org_id', orgId).eq('source', 'leads').maybeSingle();
  if (error) throw new Error('could not read lead event');
  if (!ev || ev.status === 'processed' || ev.status === 'ignored') return 'skipped';
  const attempts = Number(ev.attempts ?? 0) + 1;

  const parsed = IntakePayload.safeParse(ev.payload);
  if (!parsed.success) {
    const fields = invalidFields(parsed.error.issues);
    await db.from('integration_events').update({ status: 'ignored', attempts, error: `invalid: ${fields.join(',')}`.slice(0, 200), processed_at: new Date().toISOString() }).eq('id', eventId);
    return 'ignored';
  }
  const p = parsed.data;
  try {
    await createLead(db, orgId, {
      source: p.source, source_form: p.form ?? null, external_id: p.source_id,
      name: p.name, email: p.email, phone: p.phone, product: p.product, message: p.message, branch: p.branch,
      gclid: p.gclid, fbclid: p.fbclid, utm: p.utm ?? null, raw: ev.payload,
    }, { actor: null, notify: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : 'failed';
    await db.from('integration_events').update({ status: 'failed', attempts, error: msg }).eq('id', eventId);
    throw e;
  }
  await db.from('integration_events').update({ status: 'processed', attempts, error: null, processed_at: new Date().toISOString() }).eq('id', eventId);
  return 'processed';
}
