'use client';

// Interactive parts of the component gallery. Fictional data only; nothing here reads or writes the database.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BulkBar } from '@/components/ui/BulkBar';
import { Button } from '@/components/ui/Button';
import { ColumnPicker, type ColumnOption } from '@/components/ui/ColumnPicker';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Label, Select, Textarea } from '@/components/ui/Field';
import { FilterChips } from '@/components/ui/FilterChips';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { SavedViewsMenu, type SavedView } from '@/components/ui/SavedViewsMenu';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { StatusChip } from '@/components/ui/StatusChip';
import { NumberCell, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { TableCheckbox } from '@/components/ui/TableCheckbox';
import { Timeline } from '@/components/ui/Timeline';
import { useToast } from '@/components/ui/ToastProvider';
import { TypedConfirmModal } from '@/components/ui/TypedConfirmModal';
import { ZarAmount } from '@/components/ui/ZarAmount';
import { buttonClass } from '@/components/ui/styles';
import { livePhrase } from '@/lib/ui/confirm';
import { pageCount } from '@/lib/ui/pagination';
import { dayTime } from '@/lib/ui/time';
import type { TimelineItem } from '@/lib/ui/timeline';
import { confirmGalleryLive } from './actions';
import { GALLERY_ACTION, GALLERY_ONLY_FX_RATE, GALLERY_PAGE_SIZE, QUOTE_LINES, galleryHref, type DemoRow, type GalleryQuery } from './fixtures';

const COLUMNS: readonly { key: string; label: string; required?: boolean }[] = [
  { key: 'number', label: '#', required: true },
  { key: 'vin', label: 'VIN' },
  { key: 'inspector', label: 'Inspector' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'status', label: 'Status', required: true },
];

const BUILT_IN_VIEWS: SavedView[] = [
  { id: 'all', label: 'All entries', builtIn: true },
  { id: 'unread', label: 'Unread', builtIn: true },
  { id: 'awaiting', label: 'Awaiting approval', builtIn: true },
];

/**
 * Data table toolbar, selection, bulk bar, column picker and pagination. Rows arrive already filtered and paged by
 * the server page (URL state); the parent keys this component by filter and page, so selection resets with them.
 */
export function GalleryTable({ rows, total, query, now }: { rows: readonly DemoRow[]; total: number; query: GalleryQuery; now: string }) {
  const toast = useToast().toast;
  const [selected, setSelected] = useState<number[]>([]);
  const [read, setRead] = useState<number[]>([]);
  const [visible, setVisible] = useState<string[]>(COLUMNS.map((c) => c.key));
  const [views, setViews] = useState<SavedView[]>(BUILT_IN_VIEWS);
  const [view, setView] = useState('all');

  const columns: ColumnOption[] = COLUMNS.map((c) => ({ ...c, visible: visible.includes(c.key) }));
  const show = (key: string) => visible.includes(key);
  const allOnPage = rows.length > 0 && rows.every((r) => selected.includes(r.number));
  const someOnPage = rows.some((r) => selected.includes(r.number));
  const isUnread = (r: DemoRow) => r.unread && !read.includes(r.number);
  const colSpan = 1 + visible.length;
  const pages = pageCount(total, GALLERY_PAGE_SIZE);

  const toggleAll = (on: boolean) => setSelected(on ? rows.map((r) => r.number) : []);
  const toggle = (n: number, on: boolean) => setSelected((s) => (on ? [...s, n] : s.filter((x) => x !== n)));

  return (
    <div className="relative rounded-md border border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-3">
        <SavedViewsMenu
          views={views}
          value={view}
          onSelect={setView}
          onSave={(name) => {
            const id = `saved-${views.length + 1}`;
            setViews((v) => [...v, { id, label: name }]);
            setView(id);
            toast({ title: 'View saved', body: 'Gallery only. Nothing was stored.' });
          }}
          onDelete={(id) => {
            setViews((v) => v.filter((x) => x.id !== id));
            setView('all');
          }}
        />
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
        <span className="flex-1" />
        <ColumnPicker columns={columns} onChange={setVisible} />
      </div>
      <BulkBar count={selected.length} onClear={() => setSelected([])}>
        <button
          type="button"
          className={buttonClass('accent-outline', 30)}
          onClick={() => {
            setRead((r) => [...new Set([...r, ...selected])]);
            toast({ title: `Marked ${selected.length} read`, body: 'Gallery only. Nothing was saved.' });
            setSelected([]);
          }}
        >
          Mark read
        </button>
        <button type="button" className={buttonClass('accent-outline', 30)} onClick={() => toast({ tone: 'info', title: 'Export is not part of the gallery' })}>
          Export selected
        </button>
      </BulkBar>
      <TableWrap label="Demo entries">
        <Table>
          <THead>
            <tr>
              <TH checkbox>
                <TableCheckbox label="Select all on this page" checked={allOnPage} indeterminate={someOnPage && !allOnPage} onChange={(e) => toggleAll(e.target.checked)} disabled={!rows.length} />
              </TH>
              <TH>#</TH>
              {show('vin') ? <TH>VIN</TH> : null}
              {show('inspector') ? <TH>Inspector</TH> : null}
              {show('submitted') ? <TH>Submitted</TH> : null}
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {rows.length ? rows.map((r) => {
              const on = selected.includes(r.number);
              return (
                <TR key={r.number} selected={on} data-testid={`gallery-row-${r.number}`}>
                  <TD checkbox>
                    <TableCheckbox label={`Select entry ${r.number}`} checked={on} onChange={(e) => toggle(r.number, e.target.checked)} />
                  </TD>
                  <NumberCell number={r.number} href={galleryHref({ ...query, row: r.number })} unread={isUnread(r)} />
                  {show('vin') ? <TD mono>{r.vin}</TD> : null}
                  {show('inspector') ? <TD>{r.inspector}</TD> : null}
                  {show('submitted') ? <TD muted><time dateTime={r.submittedAt}>{dayTime(r.submittedAt, now)}</time></TD> : null}
                  <TD><StatusChip status={r.status} /></TD>
                </TR>
              );
            }) : (
              <TableEmpty colSpan={colSpan}>
                <EmptyState
                  variant="plain"
                  title="No entries match these filters"
                  body="Try another status or clear the filters."
                  action={<Link href={galleryHref({})} className="text-accent-text">Clear filters</Link>}
                />
              </TableEmpty>
            )}
          </TBody>
        </Table>
      </TableWrap>
      <Pagination
        page={query.page}
        pageCount={pages}
        total={total}
        pageSize={GALLERY_PAGE_SIZE}
        prevHref={query.page > 1 ? galleryHref({ ...query, row: null, page: query.page - 1 }) : undefined}
        nextHref={query.page < pages ? galleryHref({ ...query, row: null, page: query.page + 1 }) : undefined}
      />
    </div>
  );
}

/** Drawer driven by ?row= (Back closes it), plus the Modal and TypedConfirmModal demos. */
export function GalleryOverlays({ row, closeHref, timeline, now }: { row: DemoRow | null; closeHref: string; timeline: readonly TimelineItem[]; now: string }) {
  const router = useRouter();
  const toast = useToast().toast;
  const [lead, setLead] = useState(false);
  const [live, setLive] = useState(false);
  const total = QUOTE_LINES.reduce((n, l) => n + l.amount, 0);

  return (
    <div className="flex flex-wrap gap-2">
      <Link href={galleryHref({ row: 214 })} scroll={false} className={buttonClass('secondary', 36)}>Open drawer</Link>
      <Button variant="secondary" onClick={() => setLead(true)}>Open modal</Button>
      <Button variant="destructive" onClick={() => setLive(true)}>Switch to Live…</Button>

      <Drawer
        open={!!row}
        onClose={() => router.replace(closeHref, { scroll: false })}
        eyebrow="Inspection · Gallery"
        title={row ? `#${row.number}` : ''}
        monoTitle
        meta={row ? <><StatusChip status={row.status} /><span>{row.inspector}</span></> : null}
        closeLabel="Close drawer"
        footer={<Button variant="secondary" onClick={() => router.replace(closeHref, { scroll: false })}>Done</Button>}
      >
        {row ? (
          <>
            <dl className="m-0 grid grid-cols-2 gap-3 text-small">
              <div><dt className="text-fg-muted">VIN</dt><dd className="m-0 mt-0.5 font-mono font-medium">{row.vin}</dd></div>
              <div><dt className="text-fg-muted">Submitted</dt><dd className="m-0 mt-0.5 font-medium">{`${dayTime(row.submittedAt, now)} SAST`}</dd></div>
            </dl>
            <div className="flex flex-col gap-2">
              <h3 className="m-0 text-[15px] font-semibold leading-[22px]">Quote lines</h3>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {QUOTE_LINES.map((l) => (
                  <li key={l.description} className="flex items-center justify-between gap-3 text-small">
                    <span>{l.description}</span>
                    <ZarAmount amount={l.amount} size="sm" align="end" />
                  </li>
                ))}
                <li className="flex items-start justify-between gap-3 border-t border-border pt-2 text-small font-semibold">
                  <span>Total</span>
                  <ZarAmount amount={total} fxRate={GALLERY_ONLY_FX_RATE} size="lg" align="end" />
                </li>
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="m-0 text-[15px] font-semibold leading-[22px]">Timeline</h3>
              <Timeline items={timeline.slice(0, 3)} now={now} testId="gallery-drawer-timeline" />
            </div>
          </>
        ) : null}
      </Drawer>

      <Modal
        open={lead}
        onClose={() => setLead(false)}
        title="Add lead"
        description="Fictional form. Saving only shows a toast."
        size="lg"
      >
        <form
          className="flex flex-col gap-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            setLead(false);
            toast({ title: 'Lead added', body: 'Gallery only. Nothing was saved.' });
          }}
        >
          <div>
            <Label htmlFor="gallery-lead-company" required>Company</Label>
            <Input id="gallery-lead-company" name="company" required aria-required="true" defaultValue="Demo Haulage (Pty) Ltd" />
          </div>
          <div>
            <Label htmlFor="gallery-lead-product">Product</Label>
            <Select id="gallery-lead-product" name="product" defaultValue="tanker">
              <option value="tanker">Fuel tanker</option>
              <option value="trailer">Side tipper</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="gallery-lead-notes">Notes</Label>
            <Textarea id="gallery-lead-notes" name="notes" rows={3} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size={38} onClick={() => setLead(false)}>Cancel</Button>
            <Button type="submit" size={38}>Add lead</Button>
          </div>
        </form>
      </Modal>

      <TypedConfirmModal
        open={live}
        onClose={() => setLive(false)}
        title={<>Switch <span className="font-mono">{GALLERY_ACTION}</span> to Live?</>}
        body="The portal will start writing invoices into Xero for real. Make.com must be switched off for this action first. (Gallery: nothing is switched.)"
        phrase={livePhrase(GALLERY_ACTION)}
        confirmLabel="Go live"
        onConfirm={async (typed) => {
          const result = await confirmGalleryLive(typed);
          if (result.ok) toast({ title: `${GALLERY_ACTION} confirmed`, body: 'Gallery only. The mode did not change.' });
          return result;
        }}
      />
    </div>
  );
}

/** Off / Dry-run / Live control, local state only. */
export function GallerySegmented() {
  const [mode, setMode] = useState<'off' | 'dry_run' | 'live'>('off');
  return (
    <SegmentedControl
      name="gallery-mode"
      label="Write mode"
      value={mode}
      onChange={setMode}
      options={[{ value: 'off', label: 'Off' }, { value: 'dry_run', label: 'Dry-run' }, { value: 'live', label: 'Live' }]}
    />
  );
}

/** Button-mode filter chips (client state), as on the Tasks page. */
export function GalleryTaskChips() {
  const [value, setValue] = useState('all');
  return (
    <FilterChips
      label="Filter tasks"
      size="lg"
      value={value}
      onChange={setValue}
      chips={[
        { value: 'all', label: 'All', count: 12 },
        { value: 'inspections', label: 'Inspections', count: 7 },
        { value: 'store', label: 'Store room', count: 5 },
      ]}
    />
  );
}

/** Buttons that raise each toast tone. */
export function GalleryToastButtons() {
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => toast({ title: 'Inspection approved', body: 'Release form will be created when INV-20931 is paid.' })}>Success toast</Button>
      <Button variant="secondary" onClick={() => toast({ tone: 'info', title: 'Sync queued', body: 'Runs within a minute.', action: { label: 'View jobs', href: '/admin/dev/components#feedback' } })}>Info toast</Button>
      <Button variant="secondary" onClick={() => toast({ tone: 'error', title: 'Xero sync failed (429)', body: 'Rate limit hit. Retrying in 60 s.' })}>Error toast</Button>
    </div>
  );
}
