import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DocumentsList } from '@/components/deals/DocumentsList';
import { Journey } from '@/components/deals/Journey';
import { XeroPanel, type PanelQuote } from '@/components/deals/XeroPanel';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { StatusChip } from '@/components/ui/StatusChip';
import { buttonClass } from '@/components/ui/styles';
import { sastToday } from '@/lib/admin/mirror';
import { buildTimeline, orderInvoices, stageEntryIds, type TimelineEntryRow, type TimelineFormRow } from '@/lib/deal-files/timeline';
import { dealDocuments, type DocumentEntry, type DocumentRow } from '@/lib/deal-view/documents';
import { loadFxRate } from '@/lib/deal-view/fx-server';
import { packHref } from '@/lib/deal-view/pack';
import { buildJourney, stepActivity, type JourneyEventRow } from '@/lib/deal-view/journey';
import { dealParam, quoteLabel } from '@/lib/deal-view/search';
import { awaitingPayment, type PanelInvoiceRow } from '@/lib/deal-view/xero';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { memberNames } from '@/lib/stock/members';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Deal file · Trailers & Tankers' };

type InvoiceRow = PanelInvoiceRow & { synced_at: string | null };

/**
 * One trailer from deal to delivery (deals.read). Reads go through the caller's RLS-scoped client, pinned to their org;
 * each section checks its own area (quotes, invoices, forms) and says so when the member cannot see it. Entry data is
 * never read here: only entry metadata, timeline events and stored document rows. Xero data is the read-only mirror.
 */
export default async function DealFilePage({ params }: { params: Promise<{ quoteNo: string }> }) {
  const member = await requirePerm('deals.read');
  const { quoteNo: raw } = await params;
  const key = dealParam(raw);
  if (!key) notFound();
  if (key !== raw) redirect(`/admin/deal-files/${encodeURIComponent(key)}`);

  const canQuotes = can(member, 'quotes.read');
  const canInvoices = can(member, 'invoices.read');
  const canEntries = can(member, 'entries.read');
  const db = await createClient();
  const { data: file } = await db.from('deal_files')
    .select('quote_no, quote_id, invoice_ids, invoice_numbers, vin, customer_name, branch, rep, updated_at, deal_entry_id, rfi_entry_id, job_card_entry_id, inspection_entry_id, release_entry_id, delivery_entry_id')
    .eq('org_id', member.orgId).eq('quote_no', key).maybeSingle();
  if (!file) notFound();

  const entryIds = stageEntryIds(file);
  const invoiceIds: string[] = file.invoice_ids ?? [];
  const quoteSelect = 'quote_id, quote_number, status, currency_code, total, synced_at';
  const none = { data: null };
  const [{ data: quote }, { data: invoiceRows }, { data: entryRows }, { data: formRows }, { data: eventRows }, { data: docRows }, fxRate] = await Promise.all([
    !canQuotes ? none
      : file.quote_id
        ? db.from('xero_quotes').select(quoteSelect).eq('org_id', member.orgId).eq('quote_id', file.quote_id).maybeSingle()
        : db.from('xero_quotes').select(quoteSelect).eq('org_id', member.orgId).eq('quote_no', file.quote_no).limit(1).maybeSingle(),
    canInvoices && invoiceIds.length
      ? db.from('xero_invoices').select('invoice_id, invoice_number, status, currency_code, total, amount_due, due_date, fully_paid_on, synced_at').eq('org_id', member.orgId).in('invoice_id', invoiceIds)
      : none,
    // Metadata only: entry data (encrypted for DEAL and Delivery Note) is never selected here.
    canEntries && entryIds.length
      ? db.from('entries').select('id, number, status, summary, created_at, updated_at, form_id').eq('org_id', member.orgId).in('id', entryIds)
      : none,
    canEntries ? db.from('forms').select('id, slug, name').eq('org_id', member.orgId) : none,
    canEntries && entryIds.length
      ? db.from('entry_events').select('id, entry_id, actor_user, actor_role, from_status, to_status, created_at').eq('org_id', member.orgId).in('entry_id', entryIds).order('created_at', { ascending: true })
      : none,
    canEntries && entryIds.length
      ? db.from('entry_documents').select('id, entry_id, template_number, name, sha256, created_at').eq('org_id', member.orgId).in('entry_id', entryIds).order('created_at', { ascending: false })
      : none,
    canQuotes || canInvoices ? loadFxRate(member.orgId) : null,
  ]);

  const invoices = orderInvoices(invoiceIds, (invoiceRows ?? []) as InvoiceRow[]);
  const stages = canEntries ? buildTimeline(file, (entryRows ?? []) as TimelineEntryRow[], (formRows ?? []) as TimelineFormRow[]) : null;
  const events = (eventRows ?? []) as JourneyEventRow[];
  const slugOf = new Map<string, string>();
  const docEntries = new Map<string, DocumentEntry>();
  for (const s of stages ?? []) {
    if (!s.entry) continue;
    slugOf.set(s.entry.id, s.slug);
    docEntries.set(s.entry.id, { slug: s.slug, number: s.entry.number, formName: s.entry.formName });
  }
  // Names of staff who acted (service role after requirePerm; ids come from this org's own rows).
  const names = await memberNames(member.orgId, events.map((e) => e.actor_user));
  const journey = buildJourney({ file, stages, activity: stepActivity(events, slugOf, names), awaitingPayment: awaitingPayment(invoices) });
  const docs = dealDocuments((docRows ?? []) as DocumentRow[], docEntries);

  const label = quoteLabel(file.quote_no, (quote as PanelQuote | null)?.quote_number);
  const invoiceNos: string[] = invoices.length ? invoices.map((i) => i.invoice_number ?? '').filter(Boolean) : file.invoice_numbers ?? [];
  const now = new Date().toISOString();
  const facts: Array<{ k: string; v: string; mono?: boolean }> = [
    { k: 'Customer', v: file.customer_name ?? '—' },
    { k: 'Quote no', v: label, mono: true },
    { k: 'Invoice no', v: invoiceNos.length ? invoiceNos.join(', ') : '—', mono: true },
    { k: 'VIN', v: file.vin ?? '—', mono: true },
    { k: 'Branch', v: file.branch ?? '—' },
    { k: 'Sales rep', v: file.rep ?? '—' },
  ];

  return (
    <section className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="text-small text-fg-muted">
        <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          <li><Link href="/admin/deal-files" className="text-fg-muted">Deals</Link></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="font-mono text-fg">{label}</li>
        </ol>
      </nav>

      <Card aria-labelledby="deal-h" data-testid="deal-header">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 id="deal-h" className="m-0 break-words text-[26px] font-semibold leading-8 tracking-[-0.3px]">{file.customer_name || `Deal ${label}`}</h1>
            <span data-testid="deal-status"><StatusChip status={journey.headline.label} color={journey.headline.tone} /></span>
          </div>
          {canEntries && docs.length ? (
            // A ZIP of the latest version of each generated PDF plus manifest.txt (the route re-checks access and audits).
            <a href={packHref(file.quote_no)} download className={buttonClass('secondary', 44, 'sm:h-9')} data-testid="deal-pack">
              <Icon name="download" size={15} />
              Download pack
            </a>
          ) : null}
        </div>
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(160px,100%),1fr))] gap-x-5 gap-y-3.5">
          {facts.map((f) => (
            <div key={f.k} className="flex min-w-0 flex-col gap-[3px]">
              <dt className="text-label uppercase text-fg-muted">{f.k}</dt>
              <dd className={`m-0 break-words text-[15px] font-medium ${f.mono ? 'font-mono' : ''}`}>{f.v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Journey journey={journey} entriesHidden={!canEntries} />

      <div className="flex flex-wrap items-start gap-5">
        <XeroPanel
          quoteLabel={label}
          quote={(quote as PanelQuote | null) ?? null}
          invoices={invoices}
          canQuotes={canQuotes}
          canInvoices={canInvoices}
          fxRate={fxRate}
          today={sastToday(now)}
          now={now}
        />
        <DocumentsList docs={docs} hidden={!canEntries} />
      </div>
    </section>
  );
}
