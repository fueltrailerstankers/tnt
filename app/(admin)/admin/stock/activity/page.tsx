import Link from 'next/link';
import { StockHeader } from '@/components/stock/StockHeader';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { cardClass } from '@/components/ui/styles';
import { pageOf } from '@/lib/admin/mirror';
import { dateRange } from '@/lib/admin/grid';
import { loadOrg } from '@/lib/forms/org';
import { actionsForKind, ACTIVITY_KINDS, activityLine, activityTime, actorLabel, type AuditRow } from '@/lib/stock/activity';
import { memberNames } from '@/lib/stock/members';
import { isIsoDate } from '@/lib/stock/settings';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Stock activity · Trailers & Tankers' };

const PAGE_SIZE = 50;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

interface Dismissal { id: string; deal_id: string; reason: string; dismissed_by: string | null; dismissed_at: string }

/**
 * Activity history (stock plan 7.7, docs/M6.md section 5). stock.read. audit_log rows 'stock.*' through the caller's
 * RLS (0011 audit_stock_select), in plain words with actor and time in the org timezone; dismissal reasons come
 * from stock_deal_dismissals (the audit row carries only the dismissal_id). Names are looked up with the service
 * role after the permission check (profiles are private to their owner and admins).
 */
export default async function StockActivity({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requirePerm('stock.read');
  const sp = await searchParams;
  const kind = ACTIVITY_KINDS.find((k) => k.key === one(sp.kind))?.key ?? null;
  const from = isIsoDate(one(sp.from)) ? one(sp.from) : null;
  const to = isIsoDate(one(sp.to)) ? one(sp.to) : null;
  const page = pageOf(sp.page);
  const db = await createClient();
  const org = await loadOrg(db, member.orgId);
  const tz = org.timezone;
  const range = dateRange({ from, to }, tz);

  let q = db.from('audit_log').select('id, action, entity, entity_id, actor_user, meta, created_at', { count: 'exact' })
    .eq('org_id', member.orgId).like('action', 'stock.%');
  const actions = actionsForKind(kind);
  if (actions) q = q.in('action', [...actions]);
  if (range.from) q = q.gte('created_at', range.from);
  if (range.to) q = q.lt('created_at', range.to);
  const [{ data, count, error }, { data: locs }, { data: dismissalData }] = await Promise.all([
    q.order('created_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    db.from('stock_locations').select('id, name').eq('org_id', member.orgId),
    db.from('stock_deal_dismissals').select('id, deal_id, reason, dismissed_by, dismissed_at').eq('org_id', member.orgId)
      .order('dismissed_at', { ascending: false }).limit(20),
  ]);
  const rows = (data ?? []) as AuditRow[];
  const history = (dismissalData ?? []) as Dismissal[];

  // Reasons for dismiss rows on this page that are older than the history card shows.
  const reasons = new Map(history.map((d) => [d.id, d.reason]));
  const missing = rows.map((r) => r.action === 'stock.dismiss' ? r.meta?.dismissal_id : null)
    .filter((x): x is string => typeof x === 'string' && !reasons.has(x));
  const dealIds = [...new Set(history.map((d) => d.deal_id))];
  const [{ data: moreReasons }, { data: deals }, names] = await Promise.all([
    missing.length ? db.from('stock_deal_dismissals').select('id, reason').eq('org_id', member.orgId).in('id', missing) : Promise.resolve({ data: [] }),
    dealIds.length ? db.from('stock_deals').select('id, year, number').eq('org_id', member.orgId).in('id', dealIds) : Promise.resolve({ data: [] }),
    memberNames(member.orgId, [...rows.map((r) => r.actor_user), ...history.map((d) => d.dismissed_by)]),
  ]);
  for (const r of (moreReasons ?? []) as Array<{ id: string; reason: string }>) reasons.set(r.id, r.reason);
  const dealKey = new Map(((deals ?? []) as Array<{ id: string; year: number; number: number }>).map((d) => [d.id, `${d.year}/${d.number}`]));
  const locName = new Map(((locs ?? []) as Array<{ id: string; name: string }>).map((l) => [l.id, l.name]));
  const ctx = { locationName: (id: string) => locName.get(id), dismissalReason: (id: string) => reasons.get(id) };

  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const link = (p: number) => {
    const u = new URLSearchParams();
    if (kind) u.set('kind', kind);
    if (from) u.set('from', from);
    if (to) u.set('to', to);
    if (p > 1) u.set('page', String(p));
    return `/admin/stock/activity${u.size ? `?${u}` : ''}`;
  };

  return (
    <section className="space-y-5">
      <StockHeader eyebrow="A clear record" title="Activity history" subtitle="Dispatches and invoice changes." />

      <form method="get" className={`${cardClass} grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end`} aria-label="Filter activity">
        <div>
          <Label htmlFor="act-kind">Kind</Label>
          <Select id="act-kind" name="kind" defaultValue={kind ?? ''}>
            <option value="">All changes</option>
            {ACTIVITY_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="act-from">From</Label>
          <Input id="act-from" type="date" name="from" defaultValue={from ?? ''} />
        </div>
        <div>
          <Label htmlFor="act-to">To</Label>
          <Input id="act-to" type="date" name="to" defaultValue={to ?? ''} />
        </div>
        <div className="flex gap-2">
          <Button type="submit">Apply</Button>
          {kind || from || to ? <Link href="/admin/stock/activity" className="inline-flex h-9 items-center px-2 text-body font-semibold text-accent-text underline">Clear</Link> : null}
        </div>
      </form>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className={cardClass}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border p-4">
            <h2 className="text-h2">Changes</h2>
            <span className="text-small text-fg-muted" data-testid="activity-count">{count ?? 0} {count === 1 ? 'change' : 'changes'}</span>
          </div>
          {error ? <p role="alert" className="p-4 text-body text-status-red-fg">Activity could not be loaded. Try again.</p> : null}
          {rows.length ? (
            <ol className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="px-4 py-3" data-testid="activity-row">
                  <p className="break-words text-body text-fg">{activityLine(r, ctx)}</p>
                  <p className="text-small text-fg-muted">{activityTime(r.created_at, tz)} · {actorLabel(r, names)}</p>
                </li>
              ))}
            </ol>
          ) : !error ? (
            <p className="p-4 text-body text-fg-muted">No changes yet. Dispatches, transfers, dismissals and invoice updates appear here.</p>
          ) : null}
          {pages > 1 ? (
            <nav aria-label="Pages" className="flex items-center gap-3 border-t border-border p-4 text-body">
              {page > 1 ? <Link href={link(page - 1)} className="font-semibold text-accent-text underline">Previous</Link> : null}
              <span>Page {page} of {pages}</span>
              {page < pages ? <Link href={link(page + 1)} className="font-semibold text-accent-text underline">Next</Link> : null}
            </nav>
          ) : null}
        </div>

        <div className={`${cardClass} self-start`} data-testid="dismissal-history">
          <div className="border-b border-border p-4">
            <h2 className="text-h2">Dismissal history</h2>
            <p className="text-small text-fg-muted">Server records. Every dismissal keeps its reason, also after a restore.</p>
          </div>
          {history.length ? (
            <ul className="divide-y divide-border">
              {history.map((d) => (
                <li key={d.id} className="px-4 py-3" data-testid="dismissal-row">
                  <p className="text-body font-semibold">Dismissed {dealKey.get(d.deal_id) ?? 'deal'}</p>
                  <p className="break-words text-body">{d.reason}</p>
                  <p className="text-small text-fg-muted">{activityTime(d.dismissed_at, tz)} · {d.dismissed_by ? names.get(d.dismissed_by) ?? 'Staff' : 'System'}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-body text-fg-muted">No deals dismissed yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}
