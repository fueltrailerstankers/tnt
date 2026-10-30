'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { enqueue } from '@/lib/jobs/outbox';
import { enqueueDealsBackfill } from '@/lib/stock/deal-jobs';
import { enqueueStockSweep } from '@/lib/stock/invoice-job';
import { OPENING_MAX_CHARS, openingReport, parseOpeningCsv, planOpening, unitInsert, type ExistingUnit, type OpeningReport } from '@/lib/stock/opening';
import {
  checkRulesSwitch, INVOICE_RULE_MODES, INVOICE_RULES_KEY, INVOICES_FROM_KEY, isIsoDate, stockSettingsFrom, parseInvoiceRules, parseStockStart, RULE_MODE_LABEL, STOCK_START_KEY,
} from '@/lib/stock/settings';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';

// Pilot setup actions (docs/M6.md section 4). Each: requirePerm('stock.manage') first, Zod, then the service role
// scoped to the caller's org (app_settings 'stock.*' are server-only writes; RLS rejects client writes), and an
// audit row with keys, codes and counts only.

const PAGE = '/admin/stock/setup';
const INSERT_CHUNK = 200;
const UNIT_PAGE = 1000;

export type SetupState = { ok?: string; error?: string; at?: number };
export type OpeningState = SetupState & { report?: OpeningReport; applied?: { inserted: number; skipped: number } };

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : '';
};

type Db = ReturnType<typeof createAdminClient>;

async function currentValue(db: Db, orgId: string, key: string): Promise<unknown> {
  const { data } = await db.from('app_settings').select('value').eq('org_id', orgId).eq('key', key).maybeSingle();
  return data?.value;
}

async function audit(db: Db, orgId: string, userId: string, action: string, entity: string, entityId: string | null, meta: Record<string, unknown>) {
  await db.from('audit_log').insert({ org_id: orgId, actor_user: userId, action, entity, entity_id: entityId, meta });
}

const StartDate = z.object({ start: z.string().trim().refine((s) => s === '' || isIsoDate(s), 'Enter a valid date, or leave it empty.') });

/** Stock start date: DEAL entries created and Xero invoices changed on or after it. Empty clears it. */
export async function saveStartDate(_prev: SetupState, fd: FormData): Promise<SetupState> {
  const member = await requirePerm('stock.manage');
  const parsed = StartDate.safeParse({ start: str(fd, 'start') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Enter a valid date.', at: Date.now() };
  const to = parsed.data.start || null;
  const db = createAdminClient();
  const from = parseStockStart(await currentValue(db, member.orgId, STOCK_START_KEY));
  if (from === to) return { ok: to ? `The stock start date is already ${to}.` : 'No stock start date is set.', at: Date.now() };
  const { error } = to
    ? await db.from('app_settings').upsert(
      { org_id: member.orgId, key: STOCK_START_KEY, value: to, updated_by: member.userId, updated_at: new Date().toISOString() },
      { onConflict: 'org_id,key' },
    )
    : await db.from('app_settings').delete().eq('org_id', member.orgId).eq('key', STOCK_START_KEY);
  if (error) return { error: 'The start date could not be saved.', at: Date.now() };
  await audit(db, member.orgId, member.userId, 'stock.settings', 'app_settings', STOCK_START_KEY, { key: STOCK_START_KEY, from, to });
  // The invoice rules look at invoices changed since the start date: re-check them now rather than tonight.
  if (to) await enqueueStockSweep(db, member.orgId);
  revalidatePath(PAGE);
  return { ok: to ? `Stock start date set to ${to}. Use Rebuild deals to import the deals since then.` : 'Stock start date cleared. No new deals are imported (and, unless an invoice start date is set, no invoices are checked).', at: Date.now() };
}

/** Invoice start date ('stock.invoices_from'): first day of Xero changes the invoice rules examine. Empty = follow the stock start date. */
export async function saveInvoicesFrom(_prev: SetupState, fd: FormData): Promise<SetupState> {
  const member = await requirePerm('stock.manage');
  const parsed = StartDate.safeParse({ start: str(fd, 'invoices_from') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Enter a valid date.', at: Date.now() };
  const to = parsed.data.start || null;
  const db = createAdminClient();
  const from = parseStockStart(await currentValue(db, member.orgId, INVOICES_FROM_KEY));
  if (from === to) return { ok: to ? `The invoice start date is already ${to}.` : 'The invoice start date follows the stock start date.', at: Date.now() };
  const { error } = to
    ? await db.from('app_settings').upsert(
      { org_id: member.orgId, key: INVOICES_FROM_KEY, value: to, updated_by: member.userId, updated_at: new Date().toISOString() },
      { onConflict: 'org_id,key' },
    )
    : await db.from('app_settings').delete().eq('org_id', member.orgId).eq('key', INVOICES_FROM_KEY);
  if (error) return { error: 'The invoice start date could not be saved.', at: Date.now() };
  await audit(db, member.orgId, member.userId, 'stock.settings', 'app_settings', INVOICES_FROM_KEY, { key: INVOICES_FROM_KEY, from, to });
  await enqueueStockSweep(db, member.orgId);
  revalidatePath(PAGE);
  revalidatePath('/admin/stock/invoices');
  return { ok: to ? `Invoice start date set to ${to}.` : 'The invoice start date now follows the stock start date.', at: Date.now() };
}

const Rules = z.object({ mode: z.enum(INVOICE_RULE_MODES), confirm: z.string().max(40) });

/** Invoice rules mode. Live needs the typed confirmation "live"; every change is audited. */
export async function saveInvoiceRules(_prev: SetupState, fd: FormData): Promise<SetupState> {
  const member = await requirePerm('stock.manage');
  const parsed = Rules.safeParse({ mode: str(fd, 'mode'), confirm: str(fd, 'confirm') });
  if (!parsed.success) return { error: 'Choose off, preview or live.', at: Date.now() };
  const { mode, confirm } = parsed.data;
  const db = createAdminClient();
  const { data: rows } = await db.from('app_settings').select('key, value').eq('org_id', member.orgId).in('key', [STOCK_START_KEY, INVOICES_FROM_KEY]);
  const refused = checkRulesSwitch(mode, confirm, stockSettingsFrom(rows as Array<{ key: string; value: unknown }> | null).invoicesFrom);
  if (refused) return { error: refused, at: Date.now() };
  const stored = await currentValue(db, member.orgId, INVOICE_RULES_KEY);
  const from = parseInvoiceRules(stored);
  if (from === mode && stored !== undefined) return { ok: `The invoice rules are already ${RULE_MODE_LABEL[mode]}.`, at: Date.now() };
  const { error } = await db.from('app_settings').upsert(
    { org_id: member.orgId, key: INVOICE_RULES_KEY, value: mode, updated_by: member.userId, updated_at: new Date().toISOString() },
    { onConflict: 'org_id,key' },
  );
  if (error) return { error: 'The invoice rules could not be saved.', at: Date.now() };
  await audit(db, member.orgId, member.userId, 'stock.settings', 'app_settings', INVOICE_RULES_KEY, { key: INVOICE_RULES_KEY, from, to: mode, confirmed: mode === 'live' });
  if (mode === 'live') await enqueueStockSweep(db, member.orgId);
  revalidatePath(PAGE);
  revalidatePath('/admin/stock/invoices');
  return {
    ok: mode === 'live'
      ? 'Invoice rules are live. Invoices changed since the invoice start date are being applied.'
      : `Invoice rules: ${RULE_MODE_LABEL[mode]}.`,
    at: Date.now(),
  };
}

/** "Rebuild deals": queues the deal backfill (every DEAL entry since the start date; the job is idempotent). */
export async function rebuildDeals(): Promise<SetupState> {
  const member = await requirePerm('stock.manage');
  const db = createAdminClient();
  // Never swallowed by a pending continuation of an older pass (lib/stock/deal-jobs.ts).
  await enqueueDealsBackfill(db, member.orgId);
  await audit(db, member.orgId, member.userId, 'stock.deals_rebuild', 'stock_deals', null, {});
  const start = parseStockStart(await currentValue(db, member.orgId, STOCK_START_KEY));
  revalidatePath(PAGE);
  return {
    ok: start
      ? `Rebuild queued. Deals created since ${start} appear on the Deals tab after the next job run.`
      : 'Rebuild queued, but no stock start date is set: no deals will be imported until one is.',
    at: Date.now(),
  };
}

async function existingUnits(db: Db, orgId: string): Promise<ExistingUnit[]> {
  const out: ExistingUnit[] = [];
  for (let from = 0; ; from += UNIT_PAGE) {
    const { data, error } = await db.from('stock_units').select('vin_norm, model_part, location_id, status, invoice_number')
      .eq('org_id', orgId).order('id', { ascending: true }).range(from, from + UNIT_PAGE - 1);
    if (error) throw new Error('stock units unreadable');
    out.push(...((data ?? []) as ExistingUnit[]));
    if ((data ?? []).length < UNIT_PAGE) return out;
  }
}

const Opening = z.object({
  intent: z.enum(['check', 'apply']),
  csv: z.string().min(1, 'Choose a CSV file.').max(OPENING_MAX_CHARS, 'The file is too large (about 900 KB, 5,000 rows at most).'),
});

/**
 * Opening stock CSV: 'check' returns the dry-run report; 'apply' re-reads the same file, re-checks everything
 * against the register and inserts the new units (idempotent by VIN: registered VINs are left unchanged). Apply is
 * refused unless the file is clean. Audited with counts only.
 */
export async function importOpeningStock(_prev: OpeningState, fd: FormData): Promise<OpeningState> {
  const member = await requirePerm('stock.manage');
  const parsed = Opening.safeParse({ intent: str(fd, 'intent'), csv: str(fd, 'csv') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Choose a CSV file.', at: Date.now() };
  const { intent, csv } = parsed.data;
  const db = createAdminClient();
  const [{ data: models }, { data: locations }] = await Promise.all([
    db.from('stock_models').select('part_number').eq('org_id', member.orgId),
    db.from('stock_locations').select('id, name').eq('org_id', member.orgId),
  ]);
  const ctx = {
    models: ((models ?? []) as Array<{ part_number: string }>).map((m) => m.part_number),
    locations: (locations ?? []) as Array<{ id: string; name: string }>,
  };
  const file = parseOpeningCsv(csv, ctx);
  let units: ExistingUnit[];
  try {
    units = await existingUnits(db, member.orgId);
  } catch {
    return { error: 'The register could not be read. Try again.', at: Date.now() };
  }
  const plan = planOpening(file, units);
  const report = openingReport(file, plan);
  if (intent === 'check') return { report, at: Date.now() };
  if (!report.canApply) return { report, error: 'Fix the problems in the file and check it again before importing.', at: Date.now() };

  const now = new Date().toISOString();
  let inserted = 0;
  for (let i = 0; i < plan.insert.length; i += INSERT_CHUNK) {
    const rows = plan.insert.slice(i, i + INSERT_CHUNK).map((r) => unitInsert(r, member.orgId, member.userId, now));
    const { data, error } = await db.from('stock_units').upsert(rows, { onConflict: 'org_id,vin_norm', ignoreDuplicates: true }).select('id');
    if (error) {
      if (inserted) await audit(db, member.orgId, member.userId, 'stock.opening_import', 'stock_units', null, { inserted, skipped: plan.existing.length, rows: file.totalRows, partial: true });
      revalidatePath(PAGE);
      return { report, error: `${inserted} units were imported, then the import stopped. Check the file again: VINs already imported are skipped.`, at: Date.now() };
    }
    inserted += (data ?? []).length;
  }
  const skipped = plan.existing.length + (plan.insert.length - inserted);
  await audit(db, member.orgId, member.userId, 'stock.opening_import', 'stock_units', null, { inserted, skipped, rows: file.totalRows });
  revalidatePath(PAGE);
  revalidatePath('/admin/stock');
  return {
    report: openingReport(file, planOpening(file, await existingUnits(db, member.orgId).catch(() => units))),
    applied: { inserted, skipped },
    ok: `Imported ${inserted} new unit${inserted === 1 ? '' : 's'}${skipped ? `; ${skipped} already registered, left unchanged` : ''}.`,
    at: Date.now(),
  };
}
