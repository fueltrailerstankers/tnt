import Link from 'next/link';
import { StockHeader } from '@/components/stock/StockHeader';
import { StatusChip } from '@/components/ui/StatusChip';
import { cardClass } from '@/components/ui/styles';
import { formatMoney } from '@/lib/admin/format';
import { formatDateTime } from '@/lib/admin/grid';
import { loadOrg } from '@/lib/forms/org';
import { EXCEPTION_REASON_LABEL } from '@/lib/stock/errors';
import type { ExceptionReason } from '@/lib/stock/invoice';
import { loadItemCodes, loadModelParts, loadStockSettings, loadUnitFacts } from '@/lib/stock/invoice-job';
import { evaluateInvoice, invoicesFromInstant, MIRROR_INVOICE_COLUMNS, outcomeView, xeroStatusLabel, type MirrorInvoiceRow } from '@/lib/stock/invoice-review';
import { memberNames } from '@/lib/stock/members';
import { RULE_MODE_LABEL } from '@/lib/stock/settings';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { ManualInvoiceForm, ResolveExceptionForm } from './forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invoice review · Trailers & Tankers' };

/** Most recently changed invoices scanned for stock ones, and stock invoices listed. */
const SCAN = 300;
const SHOWN = 100;

type Row = MirrorInvoiceRow & { total: number | string | null; currency_code: string | null };
interface ExceptionRow {
  id: string; xero_invoice_id: string | null; invoice_number: string | null; reference: string | null; reason: string; unit_id: string | null;
  created_at: string; resolved_at: string | null; resolved_by: string | null; resolution: string | null;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const reasonLabel = (r: string) => EXCEPTION_REASON_LABEL[r as ExceptionReason] ?? r;

/** Cells that stack as label/value pairs on phones and sit in table columns from sm up. */
const td = 'flex justify-between gap-3 px-0 py-0.5 sm:table-cell sm:px-3 sm:py-2';
const tdLabel = 'text-small font-semibold text-fg-muted sm:hidden';

/**
 * Invoice review (stock plan 7.5 adapted, docs/M6.md section 5). stock.invoices: admin, staff, reviewer (not
 * factory: RLS hides the mirror and the exceptions from that role). Reads go through the caller's RLS; the Xero
 * connection status is read with the service role after the permission check. Outcomes are computed with the same
 * rules the stock.invoices job runs, so they show what preview would do and what live did.
 */
export default async function InvoiceReview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requirePerm('stock.invoices');
  const sp = await searchParams;
  const showResolved = one(sp.resolved) === '1';
  const manage = can(member, 'stock.manage');
  const db = await createClient();
  const [org, settings, { data: conn }] = await Promise.all([
    loadOrg(db, member.orgId),
    loadStockSettings(db, member.orgId),
    createAdminClient().from('xero_connections').select('status').eq('org_id', member.orgId).order('connected_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const tz = org.timezone;
  const connected = conn?.status === 'connected';

  // Recent stock invoices: the SCAN most recently changed mirror invoices since the stock start date, evaluated.
  let recent: Array<{ row: Row; view: ReturnType<typeof outcomeView>; vin: string | null; unitId: string | null }> = [];
  let scanned = 0;
  if (settings.start) {
    const { data: inv } = await db.from('xero_invoices').select(`${MIRROR_INVOICE_COLUMNS}, total, currency_code`)
      .eq('org_id', member.orgId).gte('updated_utc', invoicesFromInstant(settings.start, tz))
      .order('updated_utc', { ascending: false }).limit(SCAN);
    const rows = (inv ?? []) as Row[];
    scanned = rows.length;
    if (rows.length) {
      const [codes, units, parts] = await Promise.all([
        loadItemCodes(db, member.orgId, rows.map((r) => r.invoice_id)), loadUnitFacts(db, member.orgId), loadModelParts(db, member.orgId),
      ]);
      recent = rows.map((row) => {
        const o = evaluateInvoice(row, codes.get(row.invoice_id) ?? [], units, parts);
        if (o.kind === 'ignore') return null;
        return { row, view: outcomeView(o, settings.rules), vin: o.vin, unitId: o.unitId };
      }).filter((x) => x !== null).slice(0, SHOWN);
    }
  }

  const exBase = db.from('stock_invoice_exceptions')
    .select('id, xero_invoice_id, invoice_number, reference, reason, unit_id, created_at, resolved_at, resolved_by, resolution')
    .eq('org_id', member.orgId);
  const [{ data: exData }, { count: openCount }] = await Promise.all([
    showResolved
      ? exBase.not('resolved_at', 'is', null).order('resolved_at', { ascending: false }).limit(50)
      : exBase.is('resolved_at', null).order('created_at', { ascending: false }).limit(100),
    db.from('stock_invoice_exceptions').select('id', { count: 'exact', head: true }).eq('org_id', member.orgId).is('resolved_at', null),
  ]);
  const exceptions = (exData ?? []) as ExceptionRow[];
  const unitIds = [...new Set(exceptions.map((e) => e.unit_id).filter((x): x is string => !!x))];
  const [{ data: exUnits }, names] = await Promise.all([
    unitIds.length ? db.from('stock_units').select('id, vin_norm').eq('org_id', member.orgId).in('id', unitIds) : Promise.resolve({ data: [] }),
    memberNames(member.orgId, exceptions.map((e) => e.resolved_by)),
  ]);
  const vinOf = new Map(((exUnits ?? []) as Array<{ id: string; vin_norm: string }>).map((u) => [u.id, u.vin_norm]));
  const invoiceHref = (id: string | null) => (id && can(member, 'xero.read') ? `/admin/xero/invoices/${id}` : null);

  return (
    <section className="space-y-5">
      <StockHeader
        eyebrow="Invoice to stock"
        title="Invoice review"
        subtitle="Apply the agreed payment rules."
        action={(
          <>
            <StatusChip status={connected ? 'Xero connected' : 'Xero not connected'} color={connected ? 'green' : 'gray'} />
            <StatusChip status={`Rules: ${RULE_MODE_LABEL[settings.rules]}`} color={settings.rules === 'live' ? 'green' : settings.rules === 'preview' ? 'teal' : 'gray'} />
          </>
        )}
      />

      {!settings.start ? (
        <p role="status" className="rounded-sm border border-border bg-status-yellow-bg p-3 text-body text-status-yellow-fg" data-testid="no-start-date">
          No stock start date is set, so no Xero invoice is checked against stock yet.
          {manage ? <> Set it in <Link href="/admin/stock/setup" className="font-semibold underline">Pilot setup</Link>.</> : ' An admin sets it in Pilot setup.'}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${cardClass} p-4`}>
          <h2 className="text-h2">Agreed stock rules</h2>
          <p className="text-small text-fg-muted">One invoice covers one unit.</p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-body">
            <li><b>Match the reference.</b> The invoice reference contains the VIN; it is matched to one unit.</li>
            <li><b>Reserve while unpaid.</b> Unpaid or partly paid: the unit is reserved and keeps its invoice number. It stays in branch counts with an amber Reserved label.</li>
            <li><b>Remove when fully paid.</b> Fully paid: the unit is marked Sold. It leaves the counts and stays searchable.</li>
          </ol>
          <p className="mt-3 rounded-sm bg-status-yellow-bg p-2 text-small text-status-yellow-fg">
            Missing, unknown or conflicting VINs, cancellations, voids and credit notes change nothing: they go to the exceptions queue for review.
            Only invoices changed in Xero on or after the stock start date{settings.start ? ` (${settings.start})` : ''} are checked.
          </p>
          <p className="mt-2 text-small text-fg-muted">Mode: <b>{RULE_MODE_LABEL[settings.rules]}</b>. {settings.rules === 'preview'
            ? 'The outcomes below show what each invoice would do; no unit changes.'
            : settings.rules === 'live' ? 'Invoices update stock after each Xero sync and nightly.' : 'Xero invoices are not checked.'}</p>
        </div>

        {manage ? (
          <div className={`${cardClass} p-4`}>
            <h2 className="text-h2">Manual invoice update</h2>
            <p className="mb-3 text-small text-fg-muted">For an invoice that is not in Xero yet. The same rules apply; every update is recorded in Activity.</p>
            <ManualInvoiceForm />
          </div>
        ) : null}
      </div>

      <div className={cardClass} data-testid="exceptions">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="text-h2">Exceptions to review</h2>
            <p className="text-small text-fg-muted">Invoices the rules could not apply. Nothing was changed; {manage ? 'resolve each one with a note once it is handled.' : 'an admin resolves them.'}</p>
          </div>
          <div className="flex items-center gap-3 text-small">
            <span className="rounded-pill bg-surface-2 px-2.5 py-0.5 font-semibold text-fg-muted" data-testid="open-exceptions">{openCount ?? 0} open</span>
            <Link href={showResolved ? '/admin/stock/invoices' : '/admin/stock/invoices?resolved=1'} className="font-semibold text-accent-text underline">
              {showResolved ? 'Show open' : 'Show resolved'}
            </Link>
          </div>
        </div>
        {exceptions.length ? (
          <table className="w-full border-collapse text-body">
            <thead className="hidden bg-surface-2 text-left text-label font-semibold uppercase text-fg-muted sm:table-header-group">
              <tr>
                <th scope="col" className="px-3 py-2">Invoice</th><th scope="col" className="px-3 py-2">Reason</th><th scope="col" className="px-3 py-2">Reference / VIN</th>
                <th scope="col" className="px-3 py-2">{showResolved ? 'Resolved' : 'Raised'}</th><th scope="col" className="px-3 py-2"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {exceptions.map((e) => {
                const href = invoiceHref(e.xero_invoice_id);
                const vin = e.unit_id ? vinOf.get(e.unit_id) : null;
                return (
                  <tr key={e.id} className="block border-t border-border p-4 sm:table-row sm:p-0" data-testid="exception-row">
                    <td className={`${td} font-semibold`}><span className={tdLabel}>Invoice</span>
                      {href ? <Link href={href} className="underline">{e.invoice_number ?? 'No number'}</Link> : <span>{e.invoice_number ?? 'No number'}</span>}</td>
                    <td className={td}><span className={tdLabel}>Reason</span><StatusChip status={reasonLabel(e.reason)} color="red" size="sm" /></td>
                    <td className={`${td} break-all`}><span className={tdLabel}>Reference / VIN</span>
                      <span>{vin ? <Link href={`/admin/stock/units?q=${encodeURIComponent(vin)}`} className="font-mono underline">{vin}</Link> : <span className="text-fg-muted">{e.reference ?? '—'}</span>}</span></td>
                    <td className={td}><span className={tdLabel}>{showResolved ? 'Resolved' : 'Raised'}</span>
                      <span>{formatDateTime(showResolved ? e.resolved_at : e.created_at, tz)}{showResolved ? <span className="block text-small text-fg-muted">{names.get(e.resolved_by ?? '') ?? 'Team member'}: {e.resolution}</span> : null}</span></td>
                    <td className={`${td} sm:w-64`}>{!showResolved && manage ? <ResolveExceptionForm id={e.id} /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="p-4 text-body text-fg-muted">{showResolved ? 'No resolved exceptions yet.' : 'No open exceptions.'}</p>
        )}
      </div>

      <div className={cardClass} data-testid="recent-invoices">
        <div className="border-b border-border p-4">
          <h2 className="text-h2">Recent stock invoices</h2>
          <p className="text-small text-fg-muted">
            Sales invoices whose reference names a unit VIN or whose lines carry a model item code, among the {SCAN} most recently changed in Xero
            {settings.start ? ` since ${settings.start}` : ''}. Invoices without a VIN or a model item code (parts, services) are not stock invoices.
          </p>
        </div>
        {recent.length ? (
          <table className="w-full border-collapse text-body">
            <thead className="hidden bg-surface-2 text-left text-label font-semibold uppercase text-fg-muted sm:table-header-group">
              <tr>
                <th scope="col" className="px-3 py-2">Invoice</th><th scope="col" className="px-3 py-2">Changed</th><th scope="col" className="px-3 py-2">Xero status</th>
                <th scope="col" className="px-3 py-2 text-right">Amount due</th><th scope="col" className="px-3 py-2">VIN</th><th scope="col" className="px-3 py-2">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(({ row, view, vin }) => {
                const href = invoiceHref(row.invoice_id);
                return (
                  <tr key={row.invoice_id} className="block border-t border-border p-4 sm:table-row sm:p-0" data-testid="invoice-row">
                    <td className={`${td} font-semibold`}><span className={tdLabel}>Invoice</span>
                      {href ? <Link href={href} className="underline">{row.invoice_number ?? 'No number'}</Link> : <span>{row.invoice_number ?? 'No number'}</span>}</td>
                    <td className={td}><span className={tdLabel}>Changed</span><span>{formatDateTime(row.updated_utc, tz)}</span></td>
                    <td className={td}><span className={tdLabel}>Xero status</span><span>{xeroStatusLabel(row.status, row.amount_due, row.total)}</span></td>
                    <td className={`${td} sm:text-right tabular-nums`}><span className={tdLabel}>Amount due</span><span>{formatMoney(row.amount_due, row.currency_code)}</span></td>
                    <td className={`${td} break-all`}><span className={tdLabel}>VIN</span>
                      {vin ? <Link href={`/admin/stock/units?q=${encodeURIComponent(vin)}`} className="font-mono underline">{vin}</Link> : <span className="text-fg-muted">—</span>}</td>
                    <td className={td}><span className={tdLabel}>Outcome</span><StatusChip status={view.label} color={view.tone} size="sm" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="p-4 text-body text-fg-muted">
            {!settings.start ? 'Set the stock start date to check invoices.' : scanned ? 'No stock invoices among the recent Xero invoices.' : 'No Xero invoices changed since the stock start date.'}
          </p>
        )}
      </div>
    </section>
  );
}
