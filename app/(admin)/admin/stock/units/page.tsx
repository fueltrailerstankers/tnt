import Link from 'next/link';
import { StockHeader } from '@/components/stock/StockHeader';
import { UnitStatusChip } from '@/components/stock/UnitStatusChip';
import { Icon } from '@/components/ui/Icon';
import { buttonClass, tableClass, tableWrapClass, theadClass } from '@/components/ui/styles';
import { savedNotice } from '@/lib/stock/dispatch';
import { EXPORT_MAX_ROWS, exportTooManyMessage, parseRegisterQuery, REGISTER_PAGE, registerHref, registerQueryString } from '@/lib/stock/register';
import { loadLocations, loadModels, selectUnits } from '@/lib/stock/register-query';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { RegisterFilters } from './register-filters';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Unit register · Trailers & Tankers' };

/** Unit register (stock plan 7.3): every unit incl. sold history, 50 per page, filters in the URL. */
export default async function UnitRegister({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requirePerm('stock.read');
  const sp = await searchParams;
  const db = await createClient();
  const [locs, mods] = await Promise.all([loadLocations(db, member.orgId), loadModels(db, member.orgId)]);
  const locations = locs.data;
  const models = mods.data;
  const rq = parseRegisterQuery(sp, locations.map((l) => l.id), models.map((m) => m.part_number));
  const from = (rq.page - 1) * REGISTER_PAGE;
  // Without the locations and models the filters cannot be read: show the error instead of an unfiltered list.
  const setupFailed = locs.error || mods.error;
  const { rows, count, error: unitsError } = setupFailed
    ? { rows: [], count: 0, error: true }
    : await selectUnits(db, member.orgId, rq, locations, { from, to: from + REGISTER_PAGE - 1, count: true });
  const error = setupFailed || unitsError;
  const total = count ?? 0;
  const tooMany = total > EXPORT_MAX_ROWS;
  const pages = Math.max(1, Math.ceil(total / REGISTER_PAGE));
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const desc = new Map(models.map((m) => [m.part_number, m.description]));
  const exportQs = registerQueryString(rq, { page: 1 });
  const detailQs = registerQueryString(rq);
  const detailHref = (id: string) => `/admin/stock/units/${id}${detailQs ? `?${detailQs}` : ''}`;
  // Set by the dispatch page after a dispatch or a factory move (lib/stock/dispatch.ts savedUrl).
  const notice = savedNotice(sp.saved);

  return (
    <section className="space-y-4">
      <StockHeader
        eyebrow="Every unit, one record"
        title="Unit register"
        subtitle="Search current stock and sold history by VIN or sequence."
        action={!can(member, 'stock.export') || error ? null : tooMany ? (
          <span className="max-w-64 text-small text-fg-muted" data-testid="export-too-many">{exportTooManyMessage(total)}</span>
        ) : (
          <a href={`/admin/stock/units/export${exportQs ? `?${exportQs}` : ''}`} className={buttonClass('secondary', 36)} download>
            <Icon name="download" size={16} />Export CSV
          </a>
        )}
      />
      {notice ? <p role="status" className="rounded-sm border border-status-green-fg/30 bg-status-green-bg p-2 text-sm">{notice}</p> : null}

      <RegisterFilters q={rq.q} model={rq.model} location={rq.location} status={rq.status} locations={locations.map((l) => ({ id: l.id, name: l.name }))} />

      {error ? <p role="alert" className="rounded-sm bg-status-red-bg p-3 text-body text-status-red-fg">Units could not be loaded. Try again.</p> : null}
      <p className="text-small text-fg-muted" data-testid="unit-count" aria-live="polite">{total} {total === 1 ? 'unit' : 'units'}</p>

      {/* Tablet and desktop: table */}
      <div className={`${tableWrapClass} hidden md:block`}>
        <table className={tableClass} data-testid="unit-table">
          <thead className={theadClass}>
            <tr>
              <th scope="col" className="px-4 py-2 uppercase">VIN / sequence</th>
              <th scope="col" className="px-3 py-2 uppercase">Model</th>
              <th scope="col" className="px-3 py-2 uppercase">Location</th>
              <th scope="col" className="px-3 py-2 uppercase">Status</th>
              <th scope="col" className="px-3 py-2 uppercase">Invoice</th>
              <th scope="col" className="px-4 py-2"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-border" data-testid="unit-row">
                <td className="px-4 py-2.5">
                  <span className="block font-mono font-semibold">{u.vin}</span>
                  <span className="block text-small text-fg-muted">{u.sequence ? `Sequence ${u.sequence}` : 'No sequence'}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="block font-semibold">{u.model_part}</span>
                  <span className="block text-small text-fg-muted">{desc.get(u.model_part) ?? ''}</span>
                </td>
                <td className="px-3 py-2.5">{locName.get(u.location_id) ?? u.location_id}</td>
                <td className="px-3 py-2.5"><UnitStatusChip status={u.status} /></td>
                <td className="px-3 py-2.5 font-mono">{u.invoice_number ?? '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={detailHref(u.id)} className="whitespace-nowrap font-semibold text-accent-text" aria-label={`View ${u.vin}`}>View →</Link>
                </td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={6} className="p-6 text-center text-fg-muted">No units match these filters.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {/* Phone: cards */}
      <ul className="space-y-2 md:hidden" data-testid="unit-cards">
        {rows.map((u) => (
          <li key={u.id} className="rounded-md border border-border bg-surface p-3 shadow-card">
            <Link href={detailHref(u.id)} className="block text-fg no-underline" aria-label={`View ${u.vin}`}>
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-all font-mono font-semibold">{u.vin}</span>
                <UnitStatusChip status={u.status} size="sm" />
              </span>
              <span className="mt-1 block text-body">{u.model_part} · {locName.get(u.location_id) ?? u.location_id}</span>
              <span className="block text-small text-fg-muted">
                {u.sequence ? `Sequence ${u.sequence}` : 'No sequence'} · Invoice {u.invoice_number ?? '—'}
              </span>
            </Link>
          </li>
        ))}
        {!rows.length ? <li className="rounded-md border border-border bg-surface p-6 text-center text-fg-muted">No units match these filters.</li> : null}
      </ul>

      <nav aria-label="Pages" className="flex items-center gap-3 text-body">
        {rq.page > 1 ? <Link href={registerHref(rq, { page: rq.page - 1 })} className="font-semibold text-accent-text">Previous</Link> : null}
        <span>Page {rq.page} of {pages}</span>
        {rq.page < pages ? <Link href={registerHref(rq, { page: rq.page + 1 })} className="font-semibold text-accent-text">Next</Link> : null}
      </nav>
    </section>
  );
}
