import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { appEnv } from '@/lib/env';
import { sendEmail } from '@/lib/workflow/mailer';
import { findDuplicateOf, type DupCandidate } from './duplicates';
import {
  INVOICE_START_SETTING, invoiceStartFrom, matchChanged, matchColumns, matchLead, NO_MATCH,
  type ContactRow, type InvoiceRow, type LeadMatch, type QuoteRow,
} from './matching';
import { notifyClaimKey, NOTIFY_CLAIM_STALE_MS, pendingStages, stageAlreadyRecorded } from './intake';
import { normEmail, normPhone } from './normalise';
import { recipientsFor, routeLead, type RoutingRule } from './routing';
import { leadEmail } from './notify';
import { OPEN_STATUSES } from './schema';

// Lead writes. Service-role client only, and only after the caller has checked its permission
// (inbox server actions: requirePerm; intake endpoint: shared secret). Every query is filtered by org.
// Logs and lead_events.meta hold ids and field names only, never names, emails or phones.

export interface NewLead {
  source: string;
  source_form?: string | null;
  external_id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  product?: string | null;
  message?: string | null;
  branch?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  utm?: Record<string, string> | null;
  raw?: unknown;
}

export interface CreateResult {
  id: string;
  created: boolean;
  duplicateOf: string | null;
  eventKey: string;
  /** Notification outcome when this call recorded it; `unknown` when an earlier send was interrupted. */
  emailed: EmailOutcome | null;
}

export type EmailOutcome = 'sent' | 'failed' | 'skipped' | 'unknown';

type Db = SupabaseClient;

async function event(db: Db, leadId: string, kind: string, actor: string | null, meta: Record<string, unknown> = {}, body?: string) {
  const { error } = await db.from('lead_events').insert({ lead_id: leadId, kind, actor, meta, ...(body ? { body } : {}) });
  if (error && !stageAlreadyRecorded(kind, error)) throw new Error(`could not record lead event ${kind}`);
}

/** Value for a PostgREST or=() filter, or null when it holds characters we never expect in a match key. */
const orValue = (v: string | null) => (v && !/["\\,()]/.test(v) ? `"${v}"` : null);

async function duplicateOf(db: Db, orgId: string, lead: { id?: string; email_norm: string | null; phone_norm: string | null }) {
  const parts = [
    orValue(lead.email_norm) ? `email_norm.eq.${orValue(lead.email_norm)}` : null,
    orValue(lead.phone_norm) ? `phone_norm.eq.${orValue(lead.phone_norm)}` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  const { data, error } = await db.from('leads').select('id, email_norm, phone_norm, created_at, duplicate_of')
    .eq('org_id', orgId).or(parts.join(',')).order('created_at', { ascending: true }).limit(50);
  if (error) throw new Error('could not read leads for duplicates');
  return findDuplicateOf(lead, (data ?? []) as DupCandidate[]);
}

export async function invoiceStart(db: Db, orgId: string): Promise<string> {
  const { data, error } = await db.from('app_settings').select('value').eq('org_id', orgId).eq('key', INVOICE_START_SETTING).maybeSingle();
  // A failed read must not silently fall back to the default start date (it would change the match totals).
  if (error) throw new Error('could not read the invoice match start date');
  return invoiceStartFrom(data?.value);
}

/** Loads the Xero mirror rows for the lead's contacts and runs the pure matcher. */
export async function computeMatch(db: Db, orgId: string, lead: { email_norm: string | null; phone_norm: string | null }, start: string): Promise<LeadMatch> {
  const parts = [
    orValue(lead.email_norm) ? `email_norm.eq.${orValue(lead.email_norm)}` : null,
    orValue(lead.phone_norm) ? `phone_norm.eq.${orValue(lead.phone_norm)}` : null,
  ].filter(Boolean);
  if (!parts.length) return NO_MATCH;
  const { data: contacts, error } = await db.from('xero_contacts').select('contact_id, email_norm, phone_norm')
    .eq('org_id', orgId).or(parts.join(',')).limit(50);
  if (error) throw new Error('could not read contacts');
  const ids = [...new Set((contacts ?? []).map((c) => c.contact_id as string))];
  if (!ids.length) return NO_MATCH;
  const [q, i] = await Promise.all([
    db.from('xero_quotes').select('quote_id, quote_number, status, contact_id, quote_date, updated_utc, total, currency_code')
      .eq('org_id', orgId).in('contact_id', ids).limit(500),
    db.from('xero_invoices').select('invoice_id, invoice_number, invoice_type, status, contact_id, invoice_date, total, currency_code')
      .eq('org_id', orgId).in('contact_id', ids).gte('invoice_date', start).gt('total', 0).limit(1000),
  ]);
  if (q.error || i.error) throw new Error('could not read quotes or invoices');
  return matchLead(lead, { contacts: (contacts ?? []) as ContactRow[], quotes: (q.data ?? []) as QuoteRow[], invoices: (i.data ?? []) as InvoiceRow[] }, { invoiceStart: start });
}

const MATCH_COLUMNS = 'matched_contact_ids, matched_quote_id, matched_quote_number, matched_quote_status, matched_quote_total, matched_quote_currency, matched_invoice_id, matched_invoice_number, invoice_count, invoiced_total, invoiced_currency';

/** Re-matches one lead; writes and logs only when the match changed. Returns whether it changed. */
export async function matchAndStore(db: Db, orgId: string, lead: Record<string, unknown> & { id: string; email_norm: string | null; phone_norm: string | null }, start: string, actor: string | null): Promise<boolean> {
  const m = await computeMatch(db, orgId, lead, start);
  if (!matchChanged(lead, m)) return false;
  const { error } = await db.from('leads').update({ ...matchColumns(m), matched_at: new Date().toISOString() }).eq('org_id', orgId).eq('id', lead.id);
  if (error) throw new Error('could not store lead match');
  await event(db, lead.id, 'matched', actor, { quote_id: m.quote?.id ?? null, invoice_id: m.invoice?.id ?? null, contacts: m.contactIds.length, invoices: m.invoiceCount });
  return true;
}

const LEAD_COLUMNS = `id, source_form, name, email, email_norm, phone, phone_norm, product, message, branch, duplicate_of, ${MATCH_COLUMNS}`;

type LeadRow = Record<string, unknown> & {
  id: string; source_form: string | null; name: string | null; email: string | null; email_norm: string | null;
  phone: string | null; phone_norm: string | null; product: string | null; message: string | null; branch: string | null;
  duplicate_of: string | null;
};

async function leadByExternalId(db: Db, orgId: string, source: string, externalId: string): Promise<LeadRow | null> {
  const { data, error } = await db.from('leads').select(LEAD_COLUMNS)
    .eq('org_id', orgId).eq('source', source).eq('external_id', externalId).maybeSingle();
  if (error) throw new Error('could not read lead');
  return (data as unknown as LeadRow | null) ?? null;
}

/**
 * Sends the lead's intake notification at most once. The send is claimed in action_claims first; a later
 * attempt that finds the claim only records the `emailed` event (from the claim's result or email_log) and
 * never sends again. A claim with no result yet is either still sending (young: retry later) or a crash
 * mid-send (old: recorded as `unknown`, not re-sent).
 */
async function notifyOnce(db: Db, orgId: string, lead: LeadRow, sourceName: string, eventKey: string): Promise<EmailOutcome> {
  const key = notifyClaimKey(lead.id);
  // Recipients and the email are prepared before the claim, so a failed read never uses up the one-time send.
  const { data: rcpt, error: rcptError } = await db.from('notification_recipients').select('event_key, address, active').eq('org_id', orgId).like('event_key', 'leads.*');
  if (rcptError) throw new Error('could not read notification recipients');
  const to = recipientsFor(eventKey, rcpt ?? []);
  const built = leadEmail({
    id: lead.id, source_form: lead.source_form, name: lead.name, email: lead.email, phone: lead.phone,
    product: lead.product, message: lead.message, branch: lead.branch, duplicate_of: lead.duplicate_of,
  }, sourceName, appEnv().APP_URL, to);

  const claim = await db.from('action_claims').insert({ org_id: orgId, action_key: key }).select('id');
  if (claim.error) {
    if (claim.error.code !== '23505' && !/duplicate/i.test(claim.error.message ?? '')) throw new Error('could not claim lead notification');
    // Read errors must not be mistaken for "nothing recorded": that would log the email as 'unknown' for good.
    const { data: held, error: heldError } = await db.from('action_claims').select('result, claimed_at').eq('org_id', orgId).eq('action_key', key).maybeSingle();
    if (heldError) throw new Error('could not read lead notification claim');
    const result = (held?.result ?? null) as { status?: EmailOutcome; recipients?: number } | null;
    let status = result?.status ?? null;
    let recipients = result?.recipients ?? null;
    if (!status) {
      const { data: logged, error: loggedError } = await db.from('email_log').select('status, to_addresses').eq('lead_id', lead.id).eq('action', 'lead.new').limit(1);
      if (loggedError) throw new Error('could not read lead notification log');
      status = (logged?.[0]?.status as EmailOutcome | undefined) ?? null;
      recipients = Array.isArray(logged?.[0]?.to_addresses) ? (logged[0].to_addresses as unknown[]).length : null;
    }
    if (!status) {
      const age = held?.claimed_at ? Date.now() - new Date(held.claimed_at as string).getTime() : Infinity;
      if (age < NOTIFY_CLAIM_STALE_MS) throw new Error('lead notification in progress');
      status = 'unknown';
    }
    await event(db, lead.id, 'emailed', null, { event_key: eventKey, status, ...(recipients === null ? {} : { recipients }), resumed: true });
    return status;
  }

  const status = await sendEmail(db, { ...built, entryId: null, leadId: lead.id, action: 'lead.new', eventKey, attachments: [] });
  await db.from('action_claims').update({ result: { status, recipients: to.length } }).eq('org_id', orgId).eq('action_key', key);
  await event(db, lead.id, 'emailed', null, { event_key: eventKey, recipients: to.length, status });
  return status;
}

/**
 * Creates a lead: normalise, link duplicates, route, insert (idempotent on org + source + external id),
 * match against the Xero mirror, record events and, when asked, send ONE notification to the routed inboxes.
 *
 * Resumable: when the lead for this external id already exists (a retry after a partial failure, or a replay),
 * only the stages without their lead_events row run (created, duplicate, routed, matched, emailed), so each
 * completes exactly once. The notification is additionally claimed in action_claims and is never sent twice.
 */
export async function createLead(db: Db, orgId: string, input: NewLead, opts: { actor: string | null; notify: boolean }): Promise<CreateResult> {
  const email_norm = normEmail(input.email);
  const phone_norm = normPhone(input.phone);

  const [{ data: rules, error: rulesError }, { data: src }] = await Promise.all([
    db.from('routing_rules').select('id, name, priority, match_source, match_product, match_branch, assign_branch, notify_event_key, active, created_at').eq('org_id', orgId).eq('active', true),
    db.from('lead_sources').select('key, name, active').eq('org_id', orgId).eq('key', input.source).maybeSingle(),
  ]);
  if (rulesError) throw new Error('could not read routing rules'); // never route by default on a failed read
  if (!src || !src.active) throw new Error('unknown or inactive lead source');
  const route = routeLead({ source: input.source, product: input.product ?? null, branch: input.branch ?? null }, (rules ?? []) as RoutingRule[]);

  let lead = input.external_id ? await leadByExternalId(db, orgId, input.source, input.external_id) : null;
  let created = false;
  if (!lead) {
    const dup = await duplicateOf(db, orgId, { email_norm, phone_norm });
    const { data, error } = await db.from('leads').insert({
      org_id: orgId,
      source: input.source,
      source_form: input.source_form ?? null,
      external_id: input.external_id ?? null,
      name: input.name ?? null,
      email: input.email ?? null,
      email_norm,
      phone: input.phone ?? null,
      phone_norm,
      product: input.product ?? null,
      message: input.message ?? null,
      branch: route.branch,
      gclid: input.gclid ?? null,
      fbclid: input.fbclid ?? null,
      utm: input.utm ?? {},
      duplicate_of: dup,
      routing_rule_id: route.ruleId,
      raw: input.raw ?? {},
      created_by: opts.actor,
    }).select(LEAD_COLUMNS).single();
    if (error || !data) {
      // Lost a race with an identical post: resume on the lead the other request created.
      if (error?.code === '23505' && input.external_id) lead = await leadByExternalId(db, orgId, input.source, input.external_id);
      if (!lead) throw new Error('could not create lead');
    } else {
      lead = data as unknown as LeadRow;
      created = true;
    }
  }

  const { data: evs, error: evErr } = await db.from('lead_events').select('kind, meta').eq('lead_id', lead.id);
  if (evErr) throw new Error('could not read lead events');
  const events = (evs ?? []) as Array<{ kind: string; meta: Record<string, unknown> | null }>;
  const todo = pendingStages(events.map((e) => e.kind), { duplicate: Boolean(lead.duplicate_of), notify: opts.notify });

  if (todo.created) {
    const fields = Object.entries({ name: lead.name, email: lead.email, phone: lead.phone, product: lead.product, message: lead.message, branch: input.branch })
      .filter(([, v]) => v).map(([k]) => k);
    await event(db, lead.id, 'created', opts.actor, { source: input.source, fields });
  }
  if (todo.duplicate) await event(db, lead.id, 'duplicate', null, { duplicate_of: lead.duplicate_of });

  // The routed key decided the first time wins, so a retry notifies the same inboxes.
  const routedKey = events.find((e) => e.kind === 'routed')?.meta?.event_key;
  const eventKey = typeof routedKey === 'string' ? routedKey : route.eventKey;
  if (todo.routed) await event(db, lead.id, 'routed', null, { rule_id: route.ruleId, event_key: route.eventKey, branch_set: Boolean(route.branch) });

  if (todo.matched) {
    const start = await invoiceStart(db, orgId);
    await matchAndStore(db, orgId, lead, start, null);
  }

  const emailed = todo.emailed ? await notifyOnce(db, orgId, lead, src.name, eventKey) : null;
  return { id: lead.id, created, duplicateOf: lead.duplicate_of, eventKey, emailed };
}

/**
 * Re-runs Xero matching for the org's open leads in batches, starting at offset `from`. Idempotent;
 * returns counts only, plus the offset to continue from when the time budget ran out.
 */
export async function rematchOpenLeads(db: Db, orgId: string, opts: { actor?: string | null; budgetMs?: number; batch?: number; from?: number } = {}) {
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  const batch = opts.batch ?? 200;
  const start = await invoiceStart(db, orgId);
  let checked = 0;
  let changed = 0;
  let pos = opts.from ?? 0;
  while (Date.now() < deadline) {
    const { data, error } = await db.from('leads').select(`id, email_norm, phone_norm, ${MATCH_COLUMNS}`)
      .eq('org_id', orgId).in('status', [...OPEN_STATUSES]).order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(pos, pos + batch - 1);
    if (error) throw new Error('could not read leads');
    const rows = (data ?? []) as unknown as Array<{ id: string; email_norm: string | null; phone_norm: string | null } & Record<string, unknown>>;
    for (const lead of rows) {
      if (Date.now() > deadline) return { checked, changed, complete: false, next: pos };
      if (await matchAndStore(db, orgId, lead, start, opts.actor ?? null)) changed += 1;
      checked += 1;
      pos += 1;
    }
    if (rows.length < batch) return { checked, changed, complete: true, next: null };
  }
  return { checked, changed, complete: false, next: pos };
}
