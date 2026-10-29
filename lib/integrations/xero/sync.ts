import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { XeroApiError, XeroReader } from './client';
import { xeroConfig } from './config';
import { loadConnection, type Connection } from './connection';
import { mapAttachment, mapContact, mapInvoice, mapPayment, mapQuote, type LineRow } from './mappers';
import { backfillPasses, ENTITIES, incrementalPass, isLastPage, LIST_KEY, pageParams, shouldPause, type Entity } from './plan';
import { XeroAuthError } from './oauth';

// Mirror sync. Every page is written, and the cursor saved, before the next request, so a run that stops
// (time budget, rate limit, crash) resumes where it left off. Upserts are keyed on Xero ids: replaying any
// page or webhook changes nothing that is already current.

type J = Record<string, unknown>;

export type SyncMode = 'full' | 'quick';
export interface SyncResult {
  status: 'ok' | 'partial' | 'skipped' | 'error';
  reason?: string;
  processed: number;
  calls: number;
  entities: Record<string, number>;
}

interface StateRow {
  entity: string;
  backfill_done: boolean;
  pass: number;
  page: number;
  modified_since: string | null;
  cycle_started_at: string | null;
  records_synced: number;
}

async function loadState(db: SupabaseClient, orgId: string, entity: string): Promise<StateRow> {
  const { data } = await db.from('xero_sync_state').select('entity, backfill_done, pass, page, modified_since, cycle_started_at, records_synced').eq('org_id', orgId).eq('entity', entity).maybeSingle();
  if (data) return data as StateRow;
  const row = { org_id: orgId, entity, backfill_done: false, pass: 0, page: 1 };
  await db.from('xero_sync_state').upsert(row, { onConflict: 'org_id,entity', ignoreDuplicates: true });
  return { entity, backfill_done: false, pass: 0, page: 1, modified_since: null, cycle_started_at: null, records_synced: 0 };
}

async function saveState(db: SupabaseClient, orgId: string, entity: string, patch: Partial<StateRow> & Record<string, unknown>) {
  await db.from('xero_sync_state').update({ ...patch, last_run_at: new Date().toISOString() }).eq('org_id', orgId).eq('entity', entity);
}

// ---------------------------------------------------------------------------------------------------
// Upserts
// ---------------------------------------------------------------------------------------------------
const base = (c: Connection) => ({ org_id: c.orgId, tenant_id: c.tenantId, synced_at: new Date().toISOString() });

export async function upsertList(db: SupabaseClient, c: Connection, entity: Entity, list: J[]): Promise<number> {
  if (!list.length) return 0;
  if (entity === 'contacts') {
    await must(db.from('xero_contacts').upsert(list.map((j) => ({ ...base(c), ...mapContact(j) })), { onConflict: 'org_id,contact_id' }));
  } else if (entity === 'payments') {
    await must(db.from('xero_payments').upsert(list.map((j) => ({ ...base(c), ...mapPayment(j) })), { onConflict: 'org_id,payment_id' }));
  } else if (entity === 'quotes') {
    const mapped = list.map(mapQuote);
    await must(db.from('xero_quotes').upsert(mapped.map((m) => ({ ...base(c), ...m.row })), { onConflict: 'org_id,quote_id' }));
    await replaceLines(db, c, 'xero_quote_lines', 'quote_id', mapped.map((m) => ({ id: m.row.quote_id, lines: m.lines })));
  } else {
    const mapped = list.map(mapInvoice);
    await must(db.from('xero_invoices').upsert(
      // A changed invoice gets its attachment list re-read.
      mapped.map((m) => ({ ...base(c), ...m.row, attachments_synced_at: null })),
      { onConflict: 'org_id,invoice_id' },
    ));
    await replaceLines(db, c, 'xero_invoice_lines', 'invoice_id', mapped.map((m) => ({ id: m.row.invoice_id, lines: m.lines })));
  }
  return list.length;
}

async function replaceLines(db: SupabaseClient, c: Connection, table: string, key: string, docs: Array<{ id: string; lines: LineRow[] }>) {
  const ids = docs.map((d) => d.id);
  for (let i = 0; i < ids.length; i += 100) await must(db.from(table).delete().eq('org_id', c.orgId).in(key, ids.slice(i, i + 100)));
  const rows = docs.flatMap((d) => d.lines.map((l) => ({ org_id: c.orgId, [key]: d.id, ...l })));
  for (let i = 0; i < rows.length; i += 500) await must(db.from(table).insert(rows.slice(i, i + 500)));
}

async function must(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p;
  if (error) throw new Error(`mirror write failed: ${error.message}`);
}

// ---------------------------------------------------------------------------------------------------
// Entity loop
// ---------------------------------------------------------------------------------------------------
async function syncEntity(db: SupabaseClient, reader: XeroReader, entity: Entity, deadline: number): Promise<{ processed: number; finished: boolean }> {
  const c = reader.connection;
  const from = xeroConfig().XERO_BACKFILL_FROM;
  const s = await loadState(db, c.orgId, entity);
  let processed = 0;

  while (Date.now() < deadline && !shouldPause(reader.rate)) {
    const passes = s.backfill_done ? [incrementalPass(entity, s.modified_since, from)] : backfillPasses(entity, from);
    const pass = passes[Math.min(s.pass, passes.length - 1)];
    if (s.pass === 0 && s.page === 1) {
      s.cycle_started_at = new Date().toISOString();
      await saveState(db, c.orgId, entity, { cycle_started_at: s.cycle_started_at });
    }
    const res = await reader.get<J>(pass.path, { params: { ...pass.params, ...pageParams(entity, s.page) }, modifiedSince: pass.modifiedSince });
    const list = ((res?.[LIST_KEY[entity]] as J[] | undefined) ?? []);
    processed += await upsertList(db, c, entity, list);
    s.records_synced = Number(s.records_synced) + list.length;

    if (!isLastPage(entity, list.length)) {
      s.page += 1;
      await saveState(db, c.orgId, entity, { page: s.page, records_synced: s.records_synced, last_error: null });
      continue;
    }
    // Pass finished.
    if (!s.backfill_done && s.pass + 1 < passes.length) {
      s.pass += 1;
      s.page = 1;
      await saveState(db, c.orgId, entity, { pass: s.pass, page: 1, records_synced: s.records_synced, last_error: null });
      continue;
    }
    // Cycle finished: next incremental asks for changes since this cycle began.
    await saveState(db, c.orgId, entity, {
      backfill_done: true, pass: 0, page: 1, modified_since: s.cycle_started_at, cycle_started_at: null,
      records_synced: s.records_synced, last_ok_at: new Date().toISOString(), last_error: null,
    });
    return { processed, finished: true };
  }
  return { processed, finished: false };
}

/** Attachment metadata for invoices flagged HasAttachments whose list is not current. */
async function syncAttachments(db: SupabaseClient, reader: XeroReader, deadline: number): Promise<number> {
  const c = reader.connection;
  const { data } = await db.from('xero_invoices').select('invoice_id').eq('org_id', c.orgId).eq('has_attachments', true).is('attachments_synced_at', null).limit(25);
  let n = 0;
  let done = 0;
  for (const inv of data ?? []) {
    if (Date.now() > deadline || shouldPause(reader.rate)) break;
    const res = await reader.get<J>(`/Invoices/${encodeURIComponent(inv.invoice_id)}/Attachments`);
    const list = ((res?.Attachments as J[] | undefined) ?? []).map((a) => ({ org_id: c.orgId, synced_at: new Date().toISOString(), ...mapAttachment(a, 'Invoice', inv.invoice_id) }));
    if (list.length) await must(db.from('xero_attachments').upsert(list, { onConflict: 'org_id,attachment_id' }));
    await must(db.from('xero_invoices').update({ attachments_synced_at: new Date().toISOString() }).eq('org_id', c.orgId).eq('invoice_id', inv.invoice_id));
    n += list.length;
    done += 1;
  }
  // The attachment backfill is done once a run finds fewer than a batch pending and reads them all.
  const caughtUp = done === (data ?? []).length && (data ?? []).length < 25;
  await saveState(db, c.orgId, 'attachments', { last_ok_at: new Date().toISOString(), last_error: null, ...(caughtUp ? { backfill_done: true } : {}) });
  return n;
}

/** One sync run within a time budget. quick = invoices + payments (daytime); full = everything (nightly, manual). */
export async function runXeroSync(db: SupabaseClient, orgId: string, mode: SyncMode, budgetMs = 45_000): Promise<SyncResult> {
  const conn = await loadConnection(db, orgId);
  if (!conn || conn.status !== 'connected') return { status: 'skipped', reason: 'not connected', processed: 0, calls: 0, entities: {} };
  const reader = new XeroReader(db, conn);
  const deadline = Date.now() + budgetMs;
  const entities: Record<string, number> = {};
  let complete = true;
  let current: string = 'start';
  try {
    for (const e of mode === 'quick' ? (['invoices', 'payments'] as Entity[]) : ENTITIES) {
      current = e;
      const r = await syncEntity(db, reader, e, deadline);
      entities[e] = r.processed;
      if (!r.finished) {
        complete = false;
        break;
      }
    }
    if (complete && mode === 'full') {
      current = 'attachments';
      await loadState(db, orgId, 'attachments');
      entities.attachments = await syncAttachments(db, reader, deadline);
    }
    await reader.flushRate();
    const processed = Object.values(entities).reduce((a, b) => a + b, 0);
    return { status: complete ? 'ok' : 'partial', reason: complete ? undefined : shouldPause(reader.rate) ? 'rate limit headroom' : 'time budget', processed, calls: reader.calls, entities };
  } catch (e) {
    const reason = e instanceof XeroApiError ? `xero ${e.status}` : e instanceof XeroAuthError ? `auth ${e.reason}` : 'sync error';
    await saveState(db, orgId, current, { last_error: reason });
    await reader.flushRate().catch(() => undefined);
    return { status: 'error', reason, processed: Object.values(entities).reduce((a, b) => a + b, 0), calls: reader.calls, entities };
  }
}

/** Fetches one record named by a webhook event and upserts it. */
export async function fetchOne(db: SupabaseClient, orgId: string, entity: 'invoices' | 'contacts', id: string): Promise<boolean> {
  const conn = await loadConnection(db, orgId);
  if (!conn || conn.status !== 'connected') return false;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return false;
  const reader = new XeroReader(db, conn);
  const res = await reader.get<J>(`${entity === 'invoices' ? '/Invoices' : '/Contacts'}/${id}`);
  const list = (res?.[entity === 'invoices' ? 'Invoices' : 'Contacts'] as J[] | undefined) ?? [];
  await upsertList(db, conn, entity, list);
  return list.length > 0;
}
