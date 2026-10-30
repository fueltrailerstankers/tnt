// Activity history (stock plan 7.7, docs/M6.md section 5): audit_log rows 'stock.*' in plain words. Pure.
// The rows carry ids and codes only (VIN, model, location ids, deal year/number, invoice number, counts); free
// text (dismissal reasons, notes) never enters audit meta, so the page looks reasons up through dismissal_id.

import { EXCEPTION_REASON_LABEL } from './errors';
import type { ExceptionReason } from './invoice';
import { RULE_MODE_LABEL, parseInvoiceRules, INVOICE_RULES_KEY, INVOICES_FROM_KEY, STOCK_START_KEY } from './settings';

export interface AuditRow {
  id: number | string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  actor_user: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export const ACTIVITY_KINDS = [
  { key: 'dispatch', label: 'Dispatches', actions: ['stock.dispatch'] },
  { key: 'transfer', label: 'Transfers and corrections', actions: ['stock.move', 'stock.correct'] },
  { key: 'deals', label: 'Deal dismissals', actions: ['stock.dismiss', 'stock.restore'] },
  { key: 'invoices', label: 'Invoices', actions: ['stock.reserve', 'stock.sell', 'stock.exception', 'stock.exception_resolve'] },
  { key: 'setup', label: 'Setup and imports', actions: ['stock.settings', 'stock.deals_rebuild', 'stock.opening_import'] },
  { key: 'export', label: 'Exports', actions: ['stock.export'] },
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]['key'];

/** The audit actions of a kind filter; null (all stock.* rows) for an unknown or empty kind. */
export function actionsForKind(kind: string | null | undefined): readonly string[] | null {
  return ACTIVITY_KINDS.find((k) => k.key === kind)?.actions ?? null;
}

export interface ActivityContext {
  /** Location id -> name ("CPT" -> "Cape Town"). */
  locationName?: (id: string) => string | undefined;
  /** dismissal_id -> reason (from stock_deal_dismissals; readable by stock.read roles). */
  dismissalReason?: (id: string) => string | undefined;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null);

function dealOf(meta: Record<string, unknown>, prefix = ''): string | null {
  const y = str(meta[`${prefix}deal_year`]);
  const n = str(meta[`${prefix}deal_number`]);
  return y && n ? `${y}/${n}` : null;
}

const MODE_SUFFIX: Record<string, string> = { manual: ' (manual)', live: '', preview: ' (preview)' };

const FIELD_LABEL: Record<string, string> = {
  vin: 'VIN', model: 'model', location: 'location', status: 'status', invoice_number: 'invoice', deal: 'deal',
  dispatch_date: 'dispatch date', accessories: 'accessories', notes: 'notes', sequence: 'sequence', deal_year: 'deal year',
};

/** One activity line in plain words, e.g. "Dispatched 3000D · ABC123 to Cape Town · deal 2026/260". */
export function activityLine(row: AuditRow, ctx: ActivityContext = {}): string {
  const m = row.meta ?? {};
  const loc = (id: unknown) => {
    const s = str(id);
    return s ? ctx.locationName?.(s) ?? s : '—';
  };
  const vin = str(m.vin) ?? 'unit';
  const model = str(m.model);
  const unit = model ? `${model} · ${vin}` : vin;
  const deal = dealOf(m);
  const inv = str(m.invoice_number);
  switch (row.action) {
    case 'stock.dispatch':
      return `Dispatched ${unit} to ${loc(m.location)}${deal ? ` · deal ${deal}` : ''}`;
    case 'stock.move':
      return `Moved ${unit} from ${loc(m.from)} to ${loc(m.to)}${deal ? ` · deal ${deal}` : ''}`;
    case 'stock.correct': {
      const changed = Array.isArray(m.changed) ? m.changed.map((c) => FIELD_LABEL[String(c)] ?? String(c)) : [];
      const parts = [`Corrected ${unit}`];
      if (str(m.previous_vin)) parts.push(`was ${str(m.previous_vin)}`);
      if (changed.length) parts.push(`changed ${changed.join(', ')}`);
      const prev = dealOf(m, 'previous_');
      if (changed.includes('deal')) parts.push(deal ? `deal ${prev ?? 'none'} → ${deal}` : `unlinked from deal ${prev ?? '—'}`);
      return parts.join(' · ');
    }
    case 'stock.dismiss': {
      const reason = str(m.dismissal_id) ? ctx.dismissalReason?.(str(m.dismissal_id)!) : undefined;
      return `Dismissed ${deal ?? 'deal'}${reason ? ` · ${reason}` : ''}`;
    }
    case 'stock.restore':
      return `Restored ${deal ?? 'deal'}`;
    case 'stock.reserve':
      return `${vin} reserved · ${inv ?? '—'}${MODE_SUFFIX[str(m.mode) ?? ''] ?? ''}`;
    case 'stock.sell':
      return `${vin} marked Sold · ${inv ?? '—'}${MODE_SUFFIX[str(m.mode) ?? ''] ?? ''}`;
    case 'stock.exception': {
      const reason = EXCEPTION_REASON_LABEL[str(m.reason) as ExceptionReason] ?? str(m.reason) ?? 'needs review';
      return `Invoice ${inv ?? str(m.xero_invoice_id) ?? '—'} needs review · ${reason}${str(m.vin) ? ` · ${vin}` : ''}`;
    }
    case 'stock.exception_resolve': {
      const reason = EXCEPTION_REASON_LABEL[str(m.reason) as ExceptionReason] ?? str(m.reason);
      return `Resolved the exception on invoice ${inv ?? '—'}${reason ? ` · ${reason}` : ''}`;
    }
    case 'stock.settings': {
      if (m.key === STOCK_START_KEY) return str(m.to) ? `Stock start date set to ${str(m.to)}` : 'Stock start date cleared';
      if (m.key === INVOICES_FROM_KEY) return str(m.to) ? `Invoice start date set to ${str(m.to)}` : 'Invoice start date cleared (follows the stock start date)';
      if (m.key === INVOICE_RULES_KEY) {
        const from = RULE_MODE_LABEL[parseInvoiceRules(m.from)];
        const to = RULE_MODE_LABEL[parseInvoiceRules(m.to)];
        return `Invoice rules changed from ${from} to ${to}${m.confirmed ? ' (typed confirmation)' : ''}`;
      }
      return 'Stock settings changed';
    }
    case 'stock.deals_rebuild':
      return 'Rebuild of stock deals queued';
    case 'stock.opening_import': {
      const n = Number(m.inserted ?? 0) || 0;
      const skipped = Number(m.skipped ?? 0) || 0;
      return `Opening stock imported: ${n} new unit${n === 1 ? '' : 's'}${skipped ? `, ${skipped} already registered` : ''}`;
    }
    case 'stock.export': {
      const rows = str(m.rows);
      return `Exported the unit register${rows ? ` (${rows} rows)` : ''}`;
    }
    default:
      return `${row.action.replace(/^stock\./, 'Stock ').replace(/[._-]+/g, ' ')}${str(m.vin) ? ` · ${str(m.vin)}` : ''}`;
  }
}

/** "2026/03/26, 14:05:09" in the org timezone (plan 7.7 format). */
export function activityTime(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).reduce<Record<string, string>>((a, x) => (x.type === 'literal' ? a : { ...a, [x.type]: x.value }), {});
  return `${p.year}/${p.month}/${p.day}, ${p.hour}:${p.minute}:${p.second}`;
}

/** A member's display name: the full name, else "Staff" (never the email: personal data stays off stock pages). */
export function memberLabel(fullName: unknown): string {
  return typeof fullName === 'string' && fullName.trim() ? fullName.trim() : 'Staff';
}

/** Who did it: the member's name, or the job that did it when no user did (the invoice rules run as the server). */
export function actorLabel(row: Pick<AuditRow, 'actor_user' | 'action'>, names: ReadonlyMap<string, string>): string {
  if (row.actor_user) return names.get(row.actor_user) ?? 'Staff';
  if (row.action === 'stock.reserve' || row.action === 'stock.sell' || row.action === 'stock.exception') return 'Xero invoice rules';
  return 'System';
}
