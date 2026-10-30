import { describe, expect, it } from 'vitest';
import { actionsForKind, ACTIVITY_KINDS, activityLine, activityTime, actorLabel, type AuditRow } from '@/lib/stock/activity';

// Synthetic audit rows (ids, VINs and codes only, as the RPCs write them).
const row = (action: string, meta: Record<string, unknown>, actor: string | null = 'user-1'): AuditRow => ({
  id: 1, action, entity: 'stock_unit', entity_id: 'x', actor_user: actor, meta, created_at: '2026-03-26T12:05:09Z',
});
const names: Record<string, string> = { CPT: 'Cape Town', JHB: 'Johannesburg', FACTORY: 'Factory' };
const ctx = { locationName: (id: string) => names[id], dismissalReason: (id: string) => (id === 'dm-1' ? 'SENT 26/03' : undefined) };

describe('activityLine', () => {
  it('dispatch (plan 5.4 wording), with and without a deal', () => {
    expect(activityLine(row('stock.dispatch', { vin: 'TESTVIN1', model: '1000DB', location: 'CPT', deal_year: 2026, deal_number: 260 }), ctx))
      .toBe('Dispatched 1000DB · TESTVIN1 to Cape Town · deal 2026/260');
    expect(activityLine(row('stock.dispatch', { vin: 'TESTVIN1', model: '1000DB', location: 'XYZ' }), ctx)).toBe('Dispatched 1000DB · TESTVIN1 to XYZ');
  });

  it('invoices (plan 5.5 wording), manual marked', () => {
    expect(activityLine(row('stock.reserve', { vin: 'TESTVIN1', invoice_number: 'INV-1', mode: 'live' }))).toBe('TESTVIN1 reserved · INV-1');
    expect(activityLine(row('stock.sell', { vin: 'TESTVIN1', invoice_number: 'INV-1', mode: 'manual' }))).toBe('TESTVIN1 marked Sold · INV-1 (manual)');
    expect(activityLine(row('stock.exception', { invoice_number: 'INV-2', reason: 'voided', vin: 'TESTVIN1' })))
      .toBe('Invoice INV-2 needs review · Invoice voided · TESTVIN1');
    expect(activityLine(row('stock.exception', { xero_invoice_id: 'abc', reason: 'missing_vin' }))).toBe('Invoice abc needs review · No VIN in the reference');
    expect(activityLine(row('stock.exception_resolve', { invoice_number: 'INV-2', reason: 'voided' }))).toBe('Resolved the exception on invoice INV-2 · Invoice voided');
  });

  it('moves and corrections', () => {
    expect(activityLine(row('stock.move', { vin: 'TESTVIN1', model: '2500D', from: 'FACTORY', to: 'JHB', deal_year: 2026, deal_number: 5 }), ctx))
      .toBe('Moved 2500D · TESTVIN1 from Factory to Johannesburg · deal 2026/5');
    expect(activityLine(row('stock.correct', { vin: 'TESTVIN2', model: '3000D', previous_vin: 'TESTVIN1', changed: ['vin', 'location'] }), ctx))
      .toBe('Corrected 3000D · TESTVIN2 · was TESTVIN1 · changed VIN, location');
    expect(activityLine(row('stock.correct', { vin: 'TESTVIN2', changed: ['deal'], deal_year: 2026, deal_number: 7, previous_deal_year: 2026, previous_deal_number: 6 })))
      .toBe('Corrected TESTVIN2 · changed deal · deal 2026/6 → 2026/7');
    expect(activityLine(row('stock.correct', { vin: 'TESTVIN2', changed: ['deal'], previous_deal_year: 2026, previous_deal_number: 6 })))
      .toBe('Corrected TESTVIN2 · changed deal · unlinked from deal 2026/6');
  });

  it('dismiss shows the reason from the dismissal history; restore', () => {
    expect(activityLine(row('stock.dismiss', { deal_year: 2026, deal_number: 259, dismissal_id: 'dm-1' }), ctx)).toBe('Dismissed 2026/259 · SENT 26/03');
    expect(activityLine(row('stock.dismiss', { deal_year: 2026, deal_number: 259, dismissal_id: 'dm-x' }), ctx)).toBe('Dismissed 2026/259');
    expect(activityLine(row('stock.restore', { deal_year: 2026, deal_number: 259 }))).toBe('Restored 2026/259');
  });

  it('setup, import and export rows', () => {
    expect(activityLine(row('stock.settings', { key: 'stock.deals_from', from: null, to: '2026-03-01' }))).toBe('Stock start date set to 2026-03-01');
    expect(activityLine(row('stock.settings', { key: 'stock.deals_from', from: '2026-03-01', to: null }))).toBe('Stock start date cleared');
    expect(activityLine(row('stock.settings', { key: 'stock.invoice_rules', from: 'preview', to: 'live', confirmed: true })))
      .toBe('Invoice rules changed from Preview to Live (typed confirmation)');
    expect(activityLine(row('stock.deals_rebuild', {}))).toBe('Rebuild of stock deals queued');
    expect(activityLine(row('stock.opening_import', { inserted: 1, skipped: 2, rows: 3 }))).toBe('Opening stock imported: 1 new unit, 2 already registered');
    expect(activityLine(row('stock.opening_import', { inserted: 4, skipped: 0 }))).toBe('Opening stock imported: 4 new units');
    expect(activityLine(row('stock.export', { format: 'csv', rows: 12 }))).toBe('Exported the unit register (12 rows)');
  });

  it('unknown stock actions still read', () => {
    expect(activityLine(row('stock.deal_sync', { vin: 'TESTVIN1' }))).toBe('Stock deal sync · TESTVIN1');
    expect(activityLine({ ...row('stock.reserve', {}), meta: null })).toBe('unit reserved · —');
  });
});

describe('filters, time and actor', () => {
  it('kinds map to audit actions; unknown kind = all', () => {
    expect(actionsForKind('invoices')).toEqual(['stock.reserve', 'stock.sell', 'stock.exception', 'stock.exception_resolve']);
    expect(actionsForKind('nope')).toBeNull();
    expect(actionsForKind(null)).toBeNull();
    const all = ACTIVITY_KINDS.flatMap((k) => k.actions);
    expect(new Set(all).size).toBe(all.length);
    for (const a of all) expect(a.startsWith('stock.')).toBe(true);
  });

  it('time as YYYY/MM/DD, HH:mm:ss in the org timezone', () => {
    expect(activityTime('2026-03-26T12:05:09Z', 'Africa/Johannesburg')).toBe('2026/03/26, 14:05:09');
    expect(activityTime('nope', 'Africa/Johannesburg')).toBe('');
  });

  it('actor: member name, or the invoice rules / system when no user acted', () => {
    const m = new Map([['user-1', 'Test Admin']]);
    expect(actorLabel(row('stock.dispatch', {}), m)).toBe('Test Admin');
    expect(actorLabel(row('stock.dispatch', {}, 'user-2'), m)).toBe('Team member');
    expect(actorLabel(row('stock.sell', {}, null), m)).toBe('Xero invoice rules');
    expect(actorLabel(row('stock.dispatch', {}, null), m)).toBe('System');
  });
});
