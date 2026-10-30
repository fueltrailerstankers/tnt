// Activity log: which area an audit row belongs to, plain-words rendering, record links, filters and CSV. Pure.
// audit_log rows hold ids and codes only (never emails, names or free text); names come from the members list.
import { z } from 'zod';
import { AREA_LABELS, AREAS, type Area } from '@/lib/security/can';

export interface AuditRow {
  id: number;
  created_at: string;
  actor_user: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  meta: Record<string, unknown> | null;
}

/** Action prefixes per area (the area filter). The M3 Xero action names (deal., rfi., ...) belong to Integrations. */
export const AREA_ACTIONS: Partial<Record<Area, readonly string[]>> = {
  forms: ['entry.', 'entries.'],
  leads: ['lead.', 'leads.'],
  stock: ['stock.'],
  integrations: ['xero.', 'deal.', 'rfi.', 'release.', 'delivery.', 'invoice.'],
  settings: ['settings.', 'form.'],
  users: ['user.', 'auth.', 'admin.'],
  activity: ['audit.'],
};

export function areaOf(action: string): Area | null {
  for (const a of AREAS) if (AREA_ACTIONS[a]?.some((p) => action.startsWith(p))) return a;
  return null;
}

export const FILTER_AREAS = AREAS.filter((a) => AREA_ACTIONS[a]);

/** Suggestions for the action filter (any action can be typed). */
export const KNOWN_ACTIONS = [
  'auth.sign_in', 'auth.sign_out', 'auth.sign_in_failed', 'auth.password', 'user.accept', 'user.invite', 'user.invite_link',
  'user.invite_resend', 'user.add', 'user.update', 'user.disable', 'user.enable', 'user.remove', 'user.name', 'audit.export', 'settings.org',
  'form.public_link', 'entry.status', 'entry.delete', 'entries.export', 'xero.connect', 'xero.disconnect', 'xero.sync.manual',
  'xero.action.mode', 'lead.create', 'lead.assign', 'lead.status', 'stock.dispatch', 'stock.move', 'stock.correct', 'stock.dismiss',
  'stock.restore', 'stock.reserve', 'stock.sell', 'stock.exception', 'stock.export',
] as const;

/** PostgREST `or` filter for an area's actions (prefix match). */
export function areaOrFilter(area: Area): string | null {
  const prefixes = AREA_ACTIONS[area];
  return prefixes ? prefixes.map((p) => `action.like.${p}*`).join(',') : null;
}

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);

export interface Describe { text: string; href: string | null }

/** Plain words for one row: "{actor} {did what}" plus a link to the record when there is one. */
export function describe(row: AuditRow, names: ReadonlyMap<string, string>): Describe {
  const actor = row.actor_user ? names.get(row.actor_user) ?? 'A former member' : 'System';
  const target = row.entity === 'user' && row.entity_id ? names.get(row.entity_id) ?? 'a former member' : null;
  const m = row.meta ?? {};
  const a = row.action;
  const said = (what: string) => `${actor} ${what}`;
  let text: string;
  switch (a) {
    case 'auth.sign_in': text = said(m.method === 'link' ? 'signed in with an invite or sign-in link' : 'signed in'); break;
    case 'auth.sign_out': text = said('signed out'); break;
    case 'auth.sign_in_failed': text = target ? `Failed sign-in for ${target}` : 'Failed sign-in for an unknown account'; break;
    case 'auth.password': text = said(m.first ? 'replaced their temporary password' : 'changed their password'); break;
    case 'user.accept': text = said('accepted the invite and set a password'); break;
    case 'user.name': text = said('changed their name'); break;
    case 'user.invite': text = said(`invited ${target ?? 'a member'}${str(m.preset) ? ` as ${label(str(m.preset)!)}` : ''}`); break;
    case 'user.add': text = said(`added ${target ?? 'a member'}${str(m.preset) ? ` as ${label(str(m.preset)!)}` : ''} with a temporary password`); break;
    case 'user.invite_link': text = said(`created an invite link for ${target ?? 'a member'}`); break;
    case 'user.invite_resend': text = said(`resent the invite to ${target ?? 'a member'}`); break;
    case 'user.update': text = said(`changed ${target ?? 'a member'}: ${changeSummary(m)}`); break;
    case 'user.disable': text = said(`disabled ${target ?? 'a member'}`); break;
    case 'user.enable': text = said(`enabled ${target ?? 'a member'}`); break;
    case 'user.remove': text = said(`removed ${target ?? 'a member'} from the organisation`); break;
    case 'admin.provisioned': text = `Admin account ${target ?? ''} set up from the command line`.replace(/\s+/g, ' ').trim(); break;
    case 'audit.export': text = said(`exported the activity log${typeof m.rows === 'number' ? ` (${m.rows} rows)` : ''}`); break;
    case 'settings.org': text = said('changed the organisation settings'); break;
    case 'form.public_link': text = said(`turned a form's public link ${m.active ? 'on' : 'off'}`); break;
    case 'entry.status': text = said(`changed an entry's status${str(m.from) && str(m.to) ? ` from ${str(m.from)} to ${str(m.to)}` : ''}`); break;
    case 'entry.delete': text = said(`deleted entry${str(m.number) ? ` #${str(m.number)}` : ''}${str(m.form) ? ` of ${str(m.form)}` : ''}`); break;
    case 'entries.export': text = said(`exported entries${str(m.format) ? ` (${str(m.format)})` : ''}`); break;
    case 'xero.connect': text = said('connected Xero'); break;
    case 'xero.disconnect': text = said('disconnected Xero'); break;
    case 'xero.sync.manual': text = said('ran a Xero sync'); break;
    case 'xero.action.mode': text = said(`set a Xero action to ${str(m.to) ?? 'a new mode'}`); break;
    case 'stock.dispatch': text = said(`dispatched unit${str(m.vin) ? ` ${str(m.vin)}` : ''}`); break;
    case 'stock.move': text = said(`moved unit${str(m.vin) ? ` ${str(m.vin)}` : ''}${str(m.to) ? ` to ${str(m.to)}` : ''}`); break;
    case 'stock.correct': text = said(`corrected unit${str(m.vin) ? ` ${str(m.vin)}` : ''}`); break;
    case 'stock.dismiss': text = said('dismissed a deal from dispatch'); break;
    case 'stock.restore': text = said('restored a dismissed deal'); break;
    case 'stock.reserve': text = said(`reserved unit${str(m.vin) ? ` ${str(m.vin)}` : ''} on an invoice`); break;
    case 'stock.sell': text = said(`marked unit${str(m.vin) ? ` ${str(m.vin)}` : ''} sold`); break;
    case 'stock.exception': text = said('raised a stock invoice exception'); break;
    default: text = said(`did ${a.replace(/[._]/g, ' ')}${row.entity ? ` on ${row.entity.replace(/_/g, ' ')}` : ''}`);
  }
  return { text, href: hrefFor(row) };
}

function label(preset: string) {
  return preset === 'custom' ? 'Custom' : preset.charAt(0).toUpperCase() + preset.slice(1);
}

function changeSummary(m: Record<string, unknown>): string {
  const parts: string[] = [];
  if (str(m.preset_from) && str(m.preset_to) && m.preset_from !== m.preset_to) parts.push(`${label(str(m.preset_from)!)} to ${label(str(m.preset_to)!)}`);
  const changes = Array.isArray(m.changes) ? (m.changes as unknown[]) : [];
  for (const c of changes) {
    if (Array.isArray(c) && c.length === 3 && (AREAS as readonly unknown[]).includes(c[0])) {
      parts.push(`${AREA_LABELS[c[0] as Area]} ${String(c[1])} to ${String(c[2])}`);
    }
  }
  if (m.name_changed) parts.push('name');
  if (m.branch_changed) parts.push('branch');
  return parts.length ? parts.join(', ') : 'no access change';
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A link to the record, when there is a page for it. Entries and forms resolve through the open route. */
export function hrefFor(row: Pick<AuditRow, 'entity' | 'entity_id' | 'meta'>): string | null {
  const id = row.entity_id;
  if (!row.entity || !id || !ID.test(id)) return null;
  const vin = str(row.meta?.vin);
  switch (row.entity) {
    case 'user': return `/admin/settings/users/${id}`;
    case 'entry': case 'form': return `/admin/settings/activity/open/${row.entity}/${id}`;
    case 'lead': return `/admin/leads/${id}`;
    case 'org': return '/admin/settings';
    case 'xero_invoice': return `/admin/xero/invoices/${id}`;
    case 'xero_quote': return `/admin/xero/quotes/${id}`;
    case 'xero_connection': return '/admin/integrations/xero';
    case 'stock_unit': return vin && ID.test(vin) ? `/admin/stock/units?q=${encodeURIComponent(vin)}` : '/admin/stock/units';
    case 'stock_deal': return '/admin/stock/deals';
    case 'stock_invoice_exception': return '/admin/stock/invoices';
    default: return null;
  }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
export const ActivityFilters = z.object({
  user: z.guid().optional(),
  area: z.enum(AREAS).optional(),
  action: z.string().trim().regex(/^[a-z_.-]{1,60}$/).optional(),
  from: day,
  to: day,
  q: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type ActivityFilters = z.infer<typeof ActivityFilters>;

/** Parses search params, dropping (not failing on) any invalid filter. */
export function parseFilters(sp: Record<string, string | string[] | undefined>): ActivityFilters {
  const one = (k: string) => { const v = sp[k]; const s = Array.isArray(v) ? v[0] : v; return s ? s : undefined; };
  const out: Record<string, unknown> = {};
  for (const k of ['user', 'area', 'action', 'from', 'to', 'q', 'page'] as const) {
    const v = one(k);
    if (v === undefined) continue;
    const field = ActivityFilters.shape[k].safeParse(v);
    if (field.success) out[k] = field.data;
  }
  return ActivityFilters.parse(out);
}

export function filterQuery(f: ActivityFilters, over: Partial<Record<keyof ActivityFilters, string | number | null>> = {}): string {
  const u = new URLSearchParams();
  const merged: Record<string, unknown> = { ...f, page: f.page === 1 ? undefined : f.page, ...over };
  for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== null && v !== '' && !(k === 'page' && v === 1)) u.set(k, String(v));
  return u.size ? `?${u}` : '';
}

const csvCell = (v: string) => {
  // Neutralise spreadsheet formulas and quote everything.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function toCsv(rows: AuditRow[], names: ReadonlyMap<string, string>, formatTime: (iso: string) => string): string {
  const head = ['Time', 'Who', 'Area', 'Action', 'What', 'Record', 'Record id'];
  const lines = rows.map((r) => {
    const area = areaOf(r.action);
    return [
      formatTime(r.created_at),
      r.actor_user ? names.get(r.actor_user) ?? 'A former member' : 'System',
      area ? AREA_LABELS[area] : '',
      r.action,
      describe(r, names).text,
      r.entity ?? '',
      r.entity_id ?? '',
    ].map(csvCell).join(',');
  });
  return [head.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n';
}
