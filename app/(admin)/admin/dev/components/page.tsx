import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { BulkBar } from '@/components/ui/BulkBar';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ColumnPicker } from '@/components/ui/ColumnPicker';
import { CountBadge } from '@/components/ui/CountBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/Field';
import { FilterChips } from '@/components/ui/FilterChips';
import { Icon, ICONS, type IconName } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Kbd } from '@/components/ui/Kbd';
import { Pagination } from '@/components/ui/Pagination';
import { ProtectedField } from '@/components/ui/ProtectedField';
import { Spinner } from '@/components/ui/Spinner';
import { StatusChip } from '@/components/ui/StatusChip';
import { Tabs } from '@/components/ui/Tabs';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { Timeline } from '@/components/ui/Timeline';
import { Toast } from '@/components/ui/Toast';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { UnreadDot } from '@/components/ui/UnreadDot';
import { UsdAmount } from '@/components/ui/UsdAmount';
import { ZarAmount } from '@/components/ui/ZarAmount';
import { buttonClass, type ButtonSize, type ButtonVariant } from '@/components/ui/styles';
import { formatUsd, formatZar } from '@/lib/money/fx';
import { requirePerm } from '@/lib/security/require';
import { maskEmail, maskId } from '@/lib/ui/mask';
import { toneFor } from '@/lib/ui/status';
import { clampPage, pageCount } from '@/lib/ui/pagination';
import { dayTime, longDate, longDateTime, sastClock, shortDate, shortDateTime } from '@/lib/ui/time';
import { timelineItem } from '@/lib/ui/timeline';
import { revealGalleryId } from './actions';
import {
  DEMO_ROWS, DEMO_STATUSES, GALLERY_ACTION, GALLERY_ID_VALUE, GALLERY_NOW, GALLERY_ONLY_FX_RATE, GALLERY_PAGE_SIZE, QUOTE_LINES,
  TIMELINE_LABELS, TIMELINE_NAMES, TIMELINE_ROWS, galleryHref, parseGalleryQuery,
} from './fixtures';
import { GalleryOverlays, GallerySegmented, GalleryTable, GalleryTaskChips, GalleryToastButtons } from './GalleryClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Components · Trailers & Tankers' };

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'destructive', 'destructive-outline', 'accent-outline'];
const SIZES: ButtonSize[] = [30, 32, 36, 38, 44, 48, 52];
const STATUSES = ['Incomplete', 'Submitted', 'Reviewed', 'Approved', 'Changes requested', 'Archived', 'DRAFT', 'AUTHORISED', 'PAID'];

/**
 * Admin component gallery: every shared UI component with fictional fixtures, in the current theme. Development
 * only (404 in production) and admin.access. Interactive demos change local state only.
 */
export default async function ComponentsGallery({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePerm('admin.access');
  if (process.env.NODE_ENV === 'production') notFound();

  const query = parseGalleryQuery(await searchParams);
  const filtered = query.status === 'all' ? DEMO_ROWS : DEMO_ROWS.filter((r) => r.status === query.status);
  const pages = pageCount(filtered.length, GALLERY_PAGE_SIZE);
  const page = clampPage(query.page, pages);
  const rows = filtered.slice((page - 1) * GALLERY_PAGE_SIZE, page * GALLERY_PAGE_SIZE);
  const drawerRow = DEMO_ROWS.find((r) => r.number === query.row) ?? null;
  const timeline = TIMELINE_ROWS.map((r) => timelineItem(r, { names: TIMELINE_NAMES, labels: TIMELINE_LABELS }));
  const count = (s: string) => DEMO_ROWS.filter((r) => r.status === s).length;
  const total = QUOTE_LINES.reduce((n, l) => n + l.amount, 0);

  return (
    <ToastProvider>
      <div className="flex flex-col gap-6" data-testid="component-gallery">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="m-0 text-h1">Components</h1>
            <p className="m-0 max-w-2xl text-body text-fg-muted">
              Shared admin UI with fictional data. Development only; actions here change nothing. Switch the theme to
              check dark mode.
            </p>
          </div>
          <ThemeToggle />
        </header>

        <Section id="buttons" title="Buttons">
          <div className="flex flex-col gap-3">
            {VARIANTS.map((v) => (
              <div key={v} className="flex flex-wrap items-center gap-2">
                <span className="w-36 flex-none font-mono text-small text-fg-muted">{v}</span>
                <Button variant={v}>Approve</Button>
                <Button variant={v} disabled>Disabled</Button>
                <Button variant={v} loading>Saving…</Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-36 flex-none font-mono text-small text-fg-muted">link</span>
              <button type="button" className={buttonClass('link')}>Save view</button>
              <Link href="#buttons" className={buttonClass('primary', 36)}>Link styled as a button</Link>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <span className="w-36 flex-none font-mono text-small text-fg-muted">sizes</span>
              {SIZES.map((s) => <Button key={s} size={s} variant="secondary">{`${s}px`}</Button>)}
            </div>
          </div>
        </Section>

        <Section id="icons" title="Icon buttons and icons">
          <div className="flex flex-wrap items-center gap-2">
            <IconButton label="More actions" icon="more" />
            <IconButton label="Refresh" icon="refresh" size={32} />
            <IconButton label="Close" icon="close" variant="ghost" />
            <IconButton label="Next page" icon="chevronRight" size={44} />
            <IconButton label="Disabled action" icon="trash" disabled />
          </div>
          <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4 lg:grid-cols-6">
            {(Object.keys(ICONS) as IconName[]).map((name) => (
              <li key={name} className="flex items-center gap-2 rounded-sm border border-border px-2 py-1.5 text-small text-fg-muted">
                <span className="text-fg"><Icon name={name} size={18} /></span>
                <span className="truncate font-mono">{name}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="status" title="Status, badges and markers">
          <div className="flex flex-wrap items-center gap-2">
            {STATUSES.map((s) => <StatusChip key={s} status={s} />)}
            <StatusChip status="Submitted" size="sm" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="zar" />
            <Badge variant="zar" size="sm" />
            <Badge variant="auto" />
            <Badge variant="encrypted" />
            <Badge variant="test" />
            <Badge variant="neutral">Manual</Badge>
            <Badge variant="warning">Possible duplicate</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-2 text-small">Tasks <CountBadge count={3} /></span>
            <span className="inline-flex items-center gap-2 text-small">Inbox <CountBadge count={120} /></span>
            <span className="inline-flex items-center gap-2 text-small">Unread marker <UnreadDot /> <UnreadDot read /></span>
            <UnreadDot withLabel />
            <span className="inline-flex items-center gap-2">
              <Avatar name="Inspector A. Demo" />
              <Avatar name="Reviewer B. Sample" size={24} />
              <Avatar name={null} fallback="admin" size={36} />
            </span>
            <span className="inline-flex items-center gap-2 text-small text-fg-muted">Search <Kbd>/</Kbd></span>
            <span className="inline-flex items-center gap-2 text-small text-fg-muted"><Spinner /> Syncing…</span>
          </div>
        </Section>

        <Section id="money" title="Money">
          <p className="m-0 text-small text-fg-muted">
            {`Xero money is ZAR and always carries its badge. The ≈ USD line appears only with a real rate; this gallery passes an example rate (${GALLERY_ONLY_FX_RATE}) that is not a real or current rate.`}
          </p>
          <dl className="m-0 grid grid-cols-1 gap-4 text-small sm:grid-cols-2 lg:grid-cols-3">
            <KeyValue term="Summary (lg) with rate"><ZarAmount amount={total} fxRate={GALLERY_ONLY_FX_RATE} size="lg" /></KeyValue>
            <KeyValue term="Table (md), no rate"><ZarAmount amount="412000.00" /></KeyValue>
            <KeyValue term="Drawer total (sm)"><ZarAmount amount={74750} size="sm" /></KeyValue>
            <KeyValue term="Other currency"><ZarAmount amount={1250} currency="EUR" fxRate={GALLERY_ONLY_FX_RATE} /></KeyValue>
            <KeyValue term="No amount"><ZarAmount amount={null} /></KeyValue>
            <KeyValue term="Portal (USD)"><UsdAmount amount={26450} size="lg" /></KeyValue>
            <KeyValue term="formatZar / formatUsd"><span className="font-mono">{`${formatZar(486750)} · ${formatUsd(26450)}`}</span></KeyValue>
          </dl>
        </Section>

        <Section id="time" title="Time (SAST)">
          <dl className="m-0 grid grid-cols-1 gap-4 text-small sm:grid-cols-2 lg:grid-cols-3">
            <KeyValue term="sastClock"><span className="font-mono">{sastClock('2026-10-29T07:14:00Z')}</span></KeyValue>
            <KeyValue term="dayTime (today)"><span className="font-mono">{dayTime('2026-10-29T07:14:00Z', GALLERY_NOW)}</span></KeyValue>
            <KeyValue term="dayTime (yesterday)"><span className="font-mono">{dayTime('2026-10-28T13:40:00Z', GALLERY_NOW)}</span></KeyValue>
            <KeyValue term="dayTime (older)"><span className="font-mono">{dayTime('2026-10-27T13:40:00Z', GALLERY_NOW)}</span></KeyValue>
            <KeyValue term="shortDateTime"><span className="font-mono">{shortDateTime('2026-10-29T07:14:00Z')}</span></KeyValue>
            <KeyValue term="shortDate"><span className="font-mono">{shortDate('2026-10-29T07:14:00Z')}</span></KeyValue>
            <KeyValue term="longDate"><span className="font-mono">{longDate('2026-10-29T07:14:00Z')}</span></KeyValue>
            <KeyValue term="longDateTime"><span className="font-mono">{longDateTime('2026-10-29T12:31:00Z')}</span></KeyValue>
          </dl>
        </Section>

        <Section id="inputs" title="Inputs and protected fields">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="gallery-vin" required>VIN</Label>
              <Input id="gallery-vin" className="font-mono" defaultValue="TT9DEMO24D0010482" required aria-required="true" />
            </div>
            <div>
              <Label htmlFor="gallery-quote">Quote No</Label>
              <Input id="gallery-quote" aria-invalid="true" aria-describedby="gallery-quote-error" defaultValue="QU-1048" />
              <FieldError id="gallery-quote-error">Enter a quote number like QU-10482.</FieldError>
            </div>
            <div>
              <Label htmlFor="gallery-branch">Branch</Label>
              <Select id="gallery-branch" defaultValue="north">
                <option value="north">North depot</option>
                <option value="south">South depot</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="gallery-notes">Notes</Label>
              <Textarea id="gallery-notes" rows={2} defaultValue="Side markers replaced." />
            </div>
            <ProtectedField label="ID no" masked={maskId(GALLERY_ID_VALUE)} reveal={revealGalleryId} hint="protected · admin view, Reveal is logged" />
            <ProtectedField label="Email" masked={maskEmail('inspector.a@example.com')} />
          </div>
        </Section>

        <Section id="navigation" title="Navigation and filters">
          <Tabs
            label="Record type"
            items={[
              { href: galleryHref({}, '#navigation'), label: 'Quotes', current: true },
              { href: galleryHref({}, '#navigation-invoices'), label: 'Invoices' },
              { href: galleryHref({}, '#navigation-payments'), label: 'Payments' },
            ]}
          />
          <div className="flex flex-wrap items-center gap-4">
            <GallerySegmented />
            <GalleryTaskChips />
          </div>
          <FilterChips
            label="Filter by status (count chips)"
            size="sm"
            value={query.status}
            chips={[
              { value: 'all', label: 'All', count: DEMO_ROWS.length, href: galleryHref({ status: 'all' }, '#table') },
              ...DEMO_STATUSES.map((s) => ({ value: s, label: s, count: count(s), href: galleryHref({ status: s }, '#table') })),
            ]}
          />
          <Pagination page={2} pageCount={5} total={214} pageSize={50} prevHref={galleryHref({}, '#navigation')} nextHref={galleryHref({}, '#navigation')} footer={false} />
        </Section>

        <Section id="table" title="Data table">
          <FilterChips
            label="Filter by status"
            value={query.status}
            chips={[
              { value: 'all', label: 'All', dot: 'all', href: galleryHref({ status: 'all' }, '#table') },
              ...DEMO_STATUSES.map((s) => ({ value: s, label: s, dot: toneFor(s), href: galleryHref({ status: s }, '#table') })),
            ]}
          />
          <GalleryTable key={`${query.status}-${page}`} rows={rows} total={filtered.length} query={{ ...query, page }} now={GALLERY_NOW} />
          <p className="m-0 text-small text-fg-muted">Select rows for the bulk bar; open a row number for the drawer (Back closes it).</p>
          <div className="rounded-md border border-border bg-surface">
            <BulkBar count={2} clearHref={galleryHref({}, '#table')}>
              <span className="font-normal">Static bulk bar with a link to clear</span>
            </BulkBar>
            <form action={galleryHref({})} method="get" className="flex justify-end px-3.5 py-3">
              <ColumnPicker
                columns={[
                  { key: 'number', label: '#', visible: true, required: true },
                  { key: 'summary', label: 'Summary', visible: true },
                  { key: 'status', label: 'Status', visible: true, required: true },
                ]}
                lockedReason="Encrypted form. The grid lists only number, summary and status."
              />
            </form>
          </div>
        </Section>

        <Section id="timeline" title="Timeline">
          <Timeline items={timeline} now={GALLERY_NOW} testId="gallery-timeline" />
        </Section>

        <Section id="empty" title="Empty states">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <EmptyState
              title="Nothing needs you right now"
              body="Inspections and store-room counts that need review will appear here."
              action={<Link href="/admin/forms" className="text-accent-text">Go to forms</Link>}
            />
            <Card padding="none">
              <EmptyState variant="plain" icon="file" title="No quotes yet" body="Quotes appear after the first Xero sync." />
            </Card>
          </div>
        </Section>

        <Section id="feedback" title="Toasts">
          <div className="flex flex-col items-start gap-2">
            <Toast title="Inspection approved" body="Release form will be created when INV-20931 is paid." />
            <Toast tone="info" title="Sync queued" body="Runs within a minute." action={{ label: 'View jobs', href: '#feedback' }} />
            <Toast tone="error" title="Xero sync failed (429)" body="Rate limit hit. Retrying in 60 s." />
          </div>
          <GalleryToastButtons />
        </Section>

        <Section id="overlays" title="Drawer and modals">
          <p className="m-0 text-small text-fg-muted">
            {`Focus moves into each dialog, Tab stays inside, Escape or the scrim closes it and focus returns here. The typed confirmation needs exactly "LIVE ${GALLERY_ACTION}".`}
          </p>
          <GalleryOverlays row={drawerRow} closeHref={galleryHref({ status: query.status, page })} timeline={timeline} now={GALLERY_NOW} />
        </Section>
      </div>
    </ToastProvider>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <CardHeader id={`${id}-title`} title={title} variant="section" />
      {children}
    </Card>
  );
}

function KeyValue({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-fg-muted">{term}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}
