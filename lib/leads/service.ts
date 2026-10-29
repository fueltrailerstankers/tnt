import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { appEnv } from '@/lib/env';
import { sendEmail } from '@/lib/workflow/mailer';
import { findDuplicateOf, type DupCandidate } from './duplicates';
import {
  INVOICE_START_SETTING, invoiceStartFrom, matchChanged, matchColumns, matchLead, NO_MATCH,
  type ContactRow, type InvoiceRow, type LeadMatch, type QuoteRow,
} from './matching';
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
  emailed: 'sent' | 'failed' | 'skipped' | null;
}

type Db = SupabaseClient;

async function event(db: Db, leadId: string, kind: string, actor: string | null, meta: Record<string, unknown> = {}, body?: string) {
  const { error } = await db.from('lead_events').insert({ lead_id: leadId, kind, actor, meta, ...(body ? { body } : {}) });
  if (error) throw new Error(`could not record lead event ${kind}`);
}

/** Value for a PostgREST or=() filter, or null when it holds characters we never expect in a match key. */
const orValue = (v: string | null) => (v && !/["\\,()]/.test(v) ? `"${v}"` : null);

async function duplicateOf(db: Db, orgId: string, lead: { id?: string; email_norm: string | null; phone_norm: string | null }) {
  const parts = [
    orValue(lead.email_norm) ? `email_norm.eq.${orValue(lead.email_norm)}` : null,
    orValue(lead.phone_norm) ? `phone_norm.eq.${orValue(lead.phone_norm)}` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  const { data } = await db.from('leads').select('id, email_norm, phone_norm, created_at, duplicate_of')
    .eq('org_id', orgId).or(parts.join(',')).order('created_at', { ascending: true }).limit(50);
  return findDuplicateOf(lead, (data ?? []) as DupCandidate[]);
}

export async function invoiceStart(db: Db, orgId: string): Promise<string> {
  const { data } = await db.from('app_settings').select('value').eq('org_id', orgId).eq('key', INVOICE_START_SETTING).maybeSingle();
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

/**
 * Creates a lead: normalise, link duplicates, route, insert (idempotent on org + source + external id),
 * match against the Xero mirror, record events and, when asked, send ONE notification to the routed inboxes.
 */
export async function createLead(db: Db, orgId: string, input: NewLead, opts: { actor: string | null; notify: boolean }): Promise<CreateResult> {
  const email_norm = normEmail(input.email);
  const phone_norm = normPhone(input.phone);

  if (input.external_id) {
    const { data: existing } = await db.from('leads').select('id, duplicate_of')
      .eq('org_id', orgId).eq('source', input.source).eq('external_id', input.external_id).maybeSingle();
    if (existing) return { id: existing.id, created: false, duplicateOf: existing.duplicate_of, eventKey: '', emailed: null };
  }

  const [{ data: rules }, { data: src }] = await Promise.all([
    db.from('routing_rules').select('id, name, priority, match_source, match_product, match_branch, assign_branch, notify_event_key, active, created_at').eq('org_id', orgId).eq('active', true),
    db.from('lead_sources').select('key, name, active').eq('org_id', orgId).eq('key', input.source).maybeSingle(),
  ]);
  if (!src || !src.active) throw new Error('unknown or inactive lead source');

  const route = routeLead({ source: input.source, product: input.product ?? null, branch: input.branch ?? null }, (rules ?? []) as RoutingRule[]);
  const dup = await duplicateOf(db, orgId, { email_norm, phone_norm });

  const { data: lead, error } = await db.from('leads').insert({
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
  }).select('id').single();
  if (error || !lead) {
    if (error?.code === '23505' && input.external_id) {
      // Lost a race with an identical post: the other request owns the lead and its notification.
      const { data: other } = await db.from('leads').select('id, duplicate_of').eq('org_id', orgId).eq('source', input.source).eq('external_id', input.external_id).single();
      if (other) return { id: other.id, created: false, duplicateOf: other.duplicate_of, eventKey: '', emailed: null };
    }
    throw new Error('could not create lead');
  }

  const fields = Object.entries({ name: input.name, email: input.email, phone: input.phone, product: input.product, message: input.message, branch: input.branch })
    .filter(([, v]) => v).map(([k]) => k);
  await event(db, lead.id, 'created', opts.actor, { source: input.source, fields });
  if (dup) await event(db, lead.id, 'duplicate', null, { duplicate_of: dup });
  await event(db, lead.id, 'routed', null, { rule_id: route.ruleId, event_key: route.eventKey, branch_set: Boolean(route.branch) });

  const start = await invoiceStart(db, orgId);
  await matchAndStore(db, orgId, { id: lead.id, email_norm, phone_norm, matched_contact_ids: [], invoice_count: 0 }, start, null);

  let emailed: CreateResult['emailed'] = null;
  if (opts.notify) {
    const { data: rcpt } = await db.from('notification_recipients').select('event_key, address, active').eq('org_id', orgId).like('event_key', 'leads.*');
    const to = recipientsFor(route.eventKey, rcpt ?? []);
    const built = leadEmail({
      id: lead.id, source_form: input.source_form ?? null, name: input.name ?? null, email: input.email ?? null, phone: input.phone ?? null,
      product: input.product ?? null, message: input.message ?? null, branch: route.branch, duplicate_of: dup,
    }, src.name, appEnv().APP_URL, to);
    emailed = await sendEmail(db, { ...built, entryId: null, leadId: lead.id, action: 'lead.new', eventKey: route.eventKey, attachments: [] });
    await event(db, lead.id, 'emailed', null, { event_key: route.eventKey, recipients: to.length, status: emailed });
  }
  return { id: lead.id, created: true, duplicateOf: dup, eventKey: route.eventKey, emailed };
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
