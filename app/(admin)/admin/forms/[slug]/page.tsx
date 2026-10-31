import Link from 'next/link';
import { EntriesTable, type GridField, type GridRow } from '@/components/entries/EntriesTable';
import { FormTabs } from '@/components/entries/FormTabs';
import { ViewMenu, type GridView } from '@/components/entries/ViewMenu';
import { ColumnPicker } from '@/components/ui/ColumnPicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterChips } from '@/components/ui/FilterChips';
import { Icon } from '@/components/ui/Icon';
import { Pagination } from '@/components/ui/Pagination';
import { buttonClass } from '@/components/ui/styles';
import { adminForm } from '@/lib/admin/context';
import { safeNewHref } from '@/lib/admin/forms-index';
import {
  currentViewId, exportHref, gridColumns, gridHref, gridCell, gridViewQuery, hasFilters, PAGE_SIZE, parseGridQuery,
  viewChips, viewParam, visibleFieldColumns,
} from '@/lib/admin/grid';
import { listEntries, viewCounts } from '@/lib/admin/list';
import { loadForms } from '@/lib/forms/forms';
import { formUi, sortForHome } from '@/lib/home/forms';
import { can } from '@/lib/security/can';
import { inputFields } from '@/lib/spec/types';
import { dayTime } from '@/lib/ui/time';
import { listSavedViews, formScope } from '@/lib/views/saved-views';
import { NEW_ENTRY_STATUS, statusColor } from '@/lib/workflow/rules';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

const MONO = /VIN|QUOTE|INV|NUMBER|NO$/i;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: `${formUi(slug, 'Form').label} entries · Trailers & Tankers` };
}

/**
 * Entries grid (handoff Entries.dc.html). Views and status chips with counts, search and dates, columns, saved
 * views, unread dots, bulk Mark read / unread / Export selected, CSV/XLSX export and paging. Encrypted forms (DEAL,
 * Delivery Note) list only number, summary, created and status and never decrypt for the list.
 */
export default async function EntriesGrid({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { member, userDb, form, org } = await adminForm(slug, 'entries.read');
  const spec = form.spec;
  const encrypted = form.encrypt;
  const q = parseGridQuery(spec, sp);
  const ui = formUi(slug, spec.name);
  const scope = formScope(form.slug);
  const statuses = spec.workflow.statuses.map((s) => s.name);

  const [list, counts, forms, saved] = await Promise.all([
    listEntries(userDb, form, q, org.timezone, PAGE_SIZE, (q.page - 1) * PAGE_SIZE, { decrypt: !encrypted }),
    viewCounts(userDb, form, q, org.timezone, statuses),
    loadForms(userDb, member.orgId),
    // Saved views are a convenience: the grid still renders if they cannot be read.
    listSavedViews(userDb, member, scope).catch(() => []),
  ]);
  const { rows, total } = list;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const now = new Date();

  // Columns: encrypted forms have no field columns at all, so no field value reaches the page.
  const fieldCols = visibleFieldColumns(spec, encrypted, q.cols);
  const protectedFields = new Set(inputFields(spec).filter((f) => f.type === 'email' && f.protected).map((f) => f.name));
  const reveal = member.role === 'admin';
  const fields: GridField[] = fieldCols.map((c) => ({ ...c, mono: MONO.test(c.name) }));
  const gridRows: GridRow[] = rows.map((e) => ({
    id: e.id,
    number: e.number,
    href: `/admin/forms/${slug}/entries/${e.number}`,
    summary: e.summary || '(no summary)',
    status: e.status,
    statusColor: statusColor(spec, e.status),
    unread: !e.isRead && e.status !== NEW_ENTRY_STATUS,
    createdIso: e.createdAt,
    createdLabel: dayTime(e.createdAt, now),
    cells: fieldCols.map((c) => (protectedFields.has(c.name) && !reveal && e.data[c.name] ? '(protected)' : gridCell(spec, c.name, e.data[c.name], org.timezone))),
  }));

  const currentView = viewParam(q);
  const chips = viewChips(spec, counts).map((c) => ({
    ...c,
    href: gridHref(slug, spec, q, { view: c.value === 'all' ? null : c.value, page: null }),
  }));

  const savedViews = saved.map((v) => ({ id: v.id, label: v.name, href: v.href }));
  const viewId = currentViewId(slug, spec, q, savedViews);
  const views: GridView[] = [
    { id: 'all', label: 'All entries', builtIn: true, href: `/admin/forms/${slug}` },
    { id: 'unread', label: 'Unread', builtIn: true, href: `/admin/forms/${slug}?view=unread` },
    ...(viewId === 'custom' ? [{ id: 'custom', label: 'Current filters', builtIn: true, href: gridHref(slug, spec, q) }] : []),
    ...savedViews,
  ];

  const canExport = can(member, 'entries.export');
  const newHref = can(member, 'entries.write') ? safeNewHref(form, member) : null;
  const manage = can(member, 'forms.manage');
  const tabs = sortForHome(forms.filter((f) => !f.archivedAt)).map((f) => ({ slug: f.slug, label: formUi(f.slug, f.spec.name).label, encrypted: f.encrypt }));
  const filtered = hasFilters(q) || q.view !== 'all';
  const lockedReason = encrypted ? 'Encrypted form: the grid lists only number, summary, created and status.' : null;

  const empty = (
    <EmptyState
      variant="plain"
      icon="forms"
      title="No entries."
      body={filtered ? 'Nothing matches this view and these filters.' : `${ui.label} entries appear here once the form is submitted.`}
      action={filtered ? <Link href={`/admin/forms/${slug}`} className="text-accent-text">Clear filters</Link> : null}
    />
  );

  const inputCls = 'h-11 rounded-sm border border-border-strong bg-surface px-2.5 text-base text-fg outline-none focus:border-focus focus:ring-2 focus:ring-focus/25 sm:h-8 sm:text-small';

  return (
    <section className="flex flex-col gap-4" aria-labelledby="grid-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <nav aria-label="Breadcrumb" className="text-small text-fg-muted">
            <ol className="m-0 flex list-none gap-1.5 p-0">
              <li><Link href="/admin/forms" className="text-fg-muted underline underline-offset-2">Forms</Link></li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-fg">{ui.label}</li>
            </ol>
          </nav>
          <h1 id="grid-title" className="m-0 text-h1">{ui.label} entries</h1>
          <p className="m-0 text-small text-fg-muted">
            {total} entr{total === 1 ? 'y' : 'ies'} in this view{encrypted ? ' · search covers the summary only' : ''}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {canExport ? (
            <>
              <a href={exportHref(slug, q, 'csv')} aria-label="Export CSV" className={buttonClass('secondary', 44, 'flex-1 font-medium sm:h-9 sm:flex-none sm:px-3 sm:text-body')}>
                <Icon name="download" size={15} strokeWidth={2} />CSV
              </a>
              <a href={exportHref(slug, q, 'xlsx')} aria-label="Export XLSX" className={buttonClass('secondary', 44, 'flex-1 font-medium sm:h-9 sm:flex-none sm:px-3 sm:text-body')}>
                <Icon name="download" size={15} strokeWidth={2} />XLSX
              </a>
            </>
          ) : null}
          {newHref ? (
            <Link href={newHref} className={buttonClass('primary', 44, 'flex-1 sm:h-9 sm:flex-none sm:px-3.5 sm:text-body')}>
              <Icon name="plus" size={14} strokeWidth={2.25} />New entry
            </Link>
          ) : null}
        </div>
      </div>

      {form.isActive || manage ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-small">
          {form.isActive ? <Link href={`/f/${slug}`} className={buttonClass('link', 36, 'min-h-11 sm:min-h-0')}>Public link</Link> : null}
          {manage ? <Link href={`/admin/forms/${slug}/settings`} className={buttonClass('link', 36, 'min-h-11 sm:min-h-0')}>Form settings</Link> : null}
          {manage ? <Link href={`/admin/forms/${slug}/design`} className={buttonClass('link', 36, 'min-h-11 sm:min-h-0')}>Design</Link> : null}
        </div>
      ) : null}

      <FormTabs tabs={tabs} current={slug} />

      <div className="relative rounded-md border border-border bg-surface text-fg shadow-card">
        <div className="flex flex-col gap-3 border-b border-border px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <ViewMenu slug={slug} views={views} value={viewId} query={gridViewQuery(spec, q)} baseHref={`/admin/forms/${slug}`} />
            <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-border sm:block" />
            <FilterChips label="Filter by status" value={currentView ?? 'all'} size="md" chips={chips} />
          </div>
          <form method="get" className="flex flex-wrap items-end gap-2" role="search" aria-label="Filter entries">
            {currentView ? <input type="hidden" name="view" value={currentView} /> : null}
            <label className="flex w-full flex-col gap-1 text-[12px] font-semibold text-fg-muted sm:w-auto">
              Search
              <span className="flex items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-2.5 text-fg-muted focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/25">
                <Icon name="search" size={14} strokeWidth={2} />
                <input
                  name="q"
                  defaultValue={q.q ?? ''}
                  placeholder="Search entries"
                  className="h-11 w-full min-w-0 border-0 bg-transparent text-base font-normal text-fg outline-none placeholder:text-fg-subtle sm:h-[30px] sm:w-44 sm:text-small"
                />
              </span>
            </label>
            <label className="flex flex-1 flex-col gap-1 text-[12px] font-semibold text-fg-muted sm:flex-none">
              From
              <input type="date" name="from" defaultValue={q.from ?? ''} className={inputCls} />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-[12px] font-semibold text-fg-muted sm:flex-none">
              To
              <input type="date" name="to" defaultValue={q.to ?? ''} className={inputCls} />
            </label>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <button type="submit" className={buttonClass('primary', 44, 'flex-1 sm:h-8 sm:flex-none sm:px-3 sm:text-small')}>Apply</button>
              {hasFilters(q) ? <Link href={gridHref(slug, spec, q, { q: null, from: null, to: null, page: null })} className={buttonClass('ghost', 44, 'sm:h-8 sm:px-3 sm:text-small')}>Clear</Link> : null}
            </div>
            <div className="ml-auto">
              <ColumnPicker columns={gridColumns(spec, encrypted, q.cols)} lockedReason={lockedReason} />
            </div>
          </form>
        </div>

        {encrypted ? (
          <p className="m-0 flex items-start gap-2.5 border-b border-border bg-surface-2 px-3.5 py-2.5 text-small text-fg-muted">
            <span className="mt-0.5 flex-none"><Icon name="lock" size={14} strokeWidth={2} /></span>
            <span>Encrypted form. The grid lists only number, summary, created and status. Field values decrypt when you open an entry, and each open is logged.</span>
          </p>
        ) : null}

        <EntriesTable
          slug={slug}
          formLabel={ui.label}
          rows={gridRows}
          fields={fields}
          exportCsvHref={canExport ? exportHref(slug, q, 'csv') : null}
          empty={empty}
        />

        {rows.length ? (
          <Pagination
            page={q.page}
            pageCount={pages}
            total={total}
            pageSize={PAGE_SIZE}
            prevHref={q.page > 1 ? gridHref(slug, spec, q, { page: String(q.page - 1) }) : undefined}
            nextHref={q.page < pages ? gridHref(slug, spec, q, { page: String(q.page + 1) }) : undefined}
          />
        ) : null}
      </div>
    </section>
  );
}
