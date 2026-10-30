import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { StockHeader } from '@/components/stock/StockHeader';
import { UnitStatusChip } from '@/components/stock/UnitStatusChip';
import { buttonClass, cardClass } from '@/components/ui/styles';
import { formatDateTime } from '@/lib/admin/grid';
import { loadOrg } from '@/lib/forms/org';
import { dealLabel, parseRegisterQuery, registerHref } from '@/lib/stock/register';
import { loadLocations, loadModels, loadUnit } from '@/lib/stock/register-query';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { CorrectRecordForm, TransferForm } from './unit-forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Unit record · Trailers & Tankers' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Unit record (stock plan 7.3 detail): every field; admins also get Correct record and Transfer. */
export default async function UnitRecord({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const member = await requirePerm('stock.read');
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const db = await createClient();
  const [locs, mods, unit, org] = await Promise.all([
    loadLocations(db, member.orgId), loadModels(db, member.orgId), loadUnit(db, member.orgId, id), loadOrg(db, member.orgId),
  ]);
  if (!unit) notFound();
  const locations = locs.data;
  const models = mods.data;
  // The edit forms need both lists (destinations, models); without them they are not offered.
  const listsFailed = locs.error || mods.error;
  const back = registerHref(parseRegisterQuery(sp, locations.map((l) => l.id), models.map((m) => m.part_number)));
  const loc = locations.find((l) => l.id === unit.location_id);
  const model = models.find((m) => m.part_number === unit.model_part);
  const tz = org.timezone;
  const manage = can(member, 'stock.manage') && !listsFailed;
  const accessories = unit.accessories ?? [];
  const invoice = unit.invoice_number
    ? unit.xero_invoice_id && can(member, 'invoices.read')
      ? <Link href={`/admin/xero/invoices/${encodeURIComponent(unit.xero_invoice_id)}`} className="font-mono font-semibold text-accent-text">{unit.invoice_number}</Link>
      : <span className="font-mono">{unit.invoice_number}</span>
    : '—';

  return (
    <section className="space-y-4">
      <StockHeader
        eyebrow="Unit record"
        title={unit.model_part}
        subtitle={model?.description}
        action={<Link href={back} className={buttonClass('secondary', 36)}>Close</Link>}
      />

      {listsFailed ? <p role="alert" className="rounded-sm bg-status-red-bg p-3 text-body text-status-red-fg">Stock locations or models could not be loaded. Try again.</p> : null}

      <div className={`${cardClass} p-4`}>
        <dl className="grid gap-x-6 sm:grid-cols-2" data-testid="unit-record">
          <Row label="VIN"><span className="break-all font-mono font-semibold">{unit.vin}</span></Row>
          <Row label="Deal / sequence">{dealLabel(unit)}{unit.deal_id ? <span className="text-fg-muted"> · linked deal</span> : null}</Row>
          <Row label="Location">{loc?.name ?? unit.location_id}</Row>
          <Row label="Status"><UnitStatusChip status={unit.status} /></Row>
          <Row label="Invoice">{invoice}</Row>
          <Row label="Dispatch date">{unit.dispatch_date ?? '—'}</Row>
          <Row label="Accessories" wide>
            {accessories.length ? (
              <ol className="list-inside list-decimal">{accessories.map((a, i) => <li key={i}>{a}</li>)}</ol>
            ) : 'None recorded'}
          </Row>
          <Row label="Notes" wide><span className="whitespace-pre-wrap">{unit.notes ?? '—'}</span></Row>
          {unit.transfer_reason ? <Row label="Last transfer reason" wide>{unit.transfer_reason}</Row> : null}
          {unit.sold_at ? <Row label="Sold">{formatDateTime(unit.sold_at, tz)}</Row> : null}
          <Row label="Registered">{formatDateTime(unit.created_at, tz)}</Row>
          <Row label="Last changed">{formatDateTime(unit.updated_at, tz)}</Row>
        </dl>
      </div>

      {manage ? (
        <div className="space-y-3">
          <details className={`${cardClass} group`}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-h2">
              Correct record
              <span aria-hidden="true" className="text-fg-muted transition group-open:rotate-180">⌄</span>
            </summary>
            <div className="border-t border-border p-4">
              <CorrectRecordForm unit={unit} models={models} locations={locations} />
            </div>
          </details>
          <details className={`${cardClass} group`}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-h2">
              Transfer branch
              <span aria-hidden="true" className="text-fg-muted transition group-open:rotate-180">⌄</span>
            </summary>
            <div className="border-t border-border p-4">
              {unit.status === 'sold'
                ? <p className="text-body text-fg-muted">This unit is sold. Sold units are not transferred.</p>
                : <TransferForm unit={unit} locations={locations} />}
            </div>
          </details>
        </div>
      ) : null}
    </section>
  );
}

function Row({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`border-b border-border py-2.5 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-label uppercase text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-body">{children}</dd>
    </div>
  );
}
