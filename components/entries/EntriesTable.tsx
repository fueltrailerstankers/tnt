'use client';

import Link from 'next/link';
import { useState, useTransition, type ReactNode } from 'react';
import { Alert } from '@/components/ui/Alert';
import { BulkBar } from '@/components/ui/BulkBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { NumberCell, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { TableCheckbox } from '@/components/ui/TableCheckbox';
import { UnreadDot } from '@/components/ui/UnreadDot';
import { buttonClass } from '@/components/ui/styles';
import { setEntriesRead } from '@/app/(admin)/admin/forms/[slug]/actions';

export interface GridRow {
  id: string;
  number: number;
  href: string;
  summary: string;
  status: string;
  statusColor: string;
  unread: boolean;
  createdIso: string;
  createdLabel: string;
  /** Display text per visible field column (protected values already masked). Empty for encrypted forms. */
  cells: string[];
}

export interface GridField {
  name: string;
  label: string;
  /** VIN, quote and invoice numbers: mono. */
  mono: boolean;
}

/**
 * The entries table with row selection and the bulk bar (Mark read, Mark unread, Export selected). Desktop and
 * tablet get the table; phones (below 640px) get one card per entry with the same checkboxes and links.
 */
export function EntriesTable({
  slug, formLabel, rows, fields, exportCsvHref, empty,
}: {
  slug: string;
  formLabel: string;
  rows: readonly GridRow[];
  fields: readonly GridField[];
  /** The current filter's CSV export link; null without entries.export. Export selected adds sel=. */
  exportCsvHref: string | null;
  empty: ReactNode;
}) {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Rows can change under the selection (a bulk action re-renders the page); keep only ids still on the page.
  const onPage = selected.filter((id) => rows.some((r) => r.id === id));
  const allOnPage = rows.length > 0 && onPage.length === rows.length;
  const toggle = (id: string, on: boolean) => setSelected((s) => (on ? [...new Set([...s, id])] : s.filter((x) => x !== id)));
  const toggleAll = (on: boolean) => setSelected(on ? rows.map((r) => r.id) : []);
  const selectedNumbers = rows.filter((r) => onPage.includes(r.id)).map((r) => r.number);

  const mark = (mode: 'read' | 'unread') => {
    setError(null);
    const ids = [...onPage];
    start(async () => {
      const res = await setEntriesRead(slug, { ids, mode });
      if (!res.ok) { setError(res.error); return; }
      setSelected([]);
      setMessage(`Marked ${res.count} entr${res.count === 1 ? 'y' : 'ies'} ${mode}.`);
    });
  };

  if (!rows.length) {
    return (
      <>
        <p role="status" className="sr-only">{message}</p>
        {empty}
      </>
    );
  }

  return (
    <>
      <p role="status" className="sr-only">{message}</p>
      {error ? <Alert tone="error" className="mx-3.5 my-2">{error}</Alert> : null}
      <BulkBar count={onPage.length} onClear={() => setSelected([])}>
        <button type="button" disabled={pending} onClick={() => mark('read')} className={buttonClass('accent-outline', 44, 'sm:h-[30px] sm:px-2.5 sm:text-small')}>
          Mark read
        </button>
        <button type="button" disabled={pending} onClick={() => mark('unread')} className={buttonClass('accent-outline', 44, 'sm:h-[30px] sm:px-2.5 sm:text-small')}>
          Mark unread
        </button>
        {exportCsvHref ? (
          <a href={`${exportCsvHref}&sel=${selectedNumbers.join(',')}`} className={buttonClass('accent-outline', 44, 'sm:h-[30px] sm:px-2.5 sm:text-small')}>
            Export selected
          </a>
        ) : null}
      </BulkBar>

      {/* Table: 640px and up. */}
      <div className="hidden sm:block">
        <TableWrap label={`${formLabel} entries`}>
          <Table minWidth={fields.length > 3 ? 900 : 720}>
            <THead>
              <tr>
                <TH checkbox>
                  <TableCheckbox
                    label="Select all on this page"
                    checked={allOnPage}
                    indeterminate={onPage.length > 0 && !allOnPage}
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                </TH>
                <TH>#</TH>
                <TH>Summary</TH>
                {fields.map((f) => <TH key={f.name}>{f.label}</TH>)}
                <TH>Created</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => {
                const on = onPage.includes(r.id);
                return (
                  <TR key={r.id} selected={on} data-testid={`entry-${r.number}`}>
                    <TD checkbox>
                      <TableCheckbox label={`Select entry ${r.number}`} checked={on} onChange={(e) => toggle(r.id, e.target.checked)} />
                    </TD>
                    <NumberCell number={r.number} href={r.href} unread={r.unread} />
                    <TD className="max-w-[280px]">
                      <Link href={r.href} className={`block truncate text-fg no-underline hover:underline ${r.unread ? 'font-semibold' : ''}`}>
                        {r.summary}
                      </Link>
                    </TD>
                    {fields.map((f, i) => (
                      <TD key={f.name} mono={f.mono} className="max-w-[240px] truncate">{r.cells[i]}</TD>
                    ))}
                    <TD muted><time dateTime={r.createdIso}>{r.createdLabel}</time></TD>
                    <TD><StatusChip status={r.status} color={r.statusColor} /></TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableWrap>
      </div>

      {/* Phone: one card per entry, 44px targets. */}
      <div className="sm:hidden">
        <div className="flex items-center gap-3 border-b border-border px-3.5 py-1">
              <TableCheckbox
                label="Select all on this page"
                checked={allOnPage}
                indeterminate={onPage.length > 0 && !allOnPage}
                onChange={(e) => toggleAll(e.target.checked)}
              />
              <span aria-hidden="true" className="text-small text-fg-muted">Select all</span>
            </div>
            <ul className="m-0 list-none p-0" aria-label={`${formLabel} entries`}>
              {rows.map((r) => {
                const on = onPage.includes(r.id);
                return (
                  <li key={r.id} data-testid={`entry-card-${r.number}`} className={`flex gap-3 border-b border-border px-3.5 py-3 last:border-b-0 ${on ? 'bg-accent-soft' : ''}`}>
                    <div className="pt-1">
                      <TableCheckbox label={`Select entry ${r.number}`} checked={on} onChange={(e) => toggle(r.id, e.target.checked)} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2 text-small text-fg-muted">
                          <UnreadDot read={!r.unread} />
                          <span className={r.unread ? 'font-semibold text-fg' : undefined}>#{r.number}</span>
                        </span>
                        <StatusChip status={r.status} color={r.statusColor} size="sm" />
                      </div>
                      <Link href={r.href} className={`flex min-h-11 items-center break-words text-body text-fg no-underline hover:underline ${r.unread ? 'font-semibold' : ''}`}>
                        {r.summary}
                      </Link>
                      {fields.length ? (
                        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-small">
                          {fields.slice(0, 3).map((f, i) => (
                            <div key={f.name} className="contents">
                              <dt className="text-fg-muted">{f.label}</dt>
                              <dd className={`m-0 min-w-0 truncate ${f.mono ? 'font-mono' : ''}`}>{r.cells[i] || '—'}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      <time dateTime={r.createdIso} className="text-small text-fg-muted">{r.createdLabel}</time>
                    </div>
                  </li>
                );
              })}
            </ul>
      </div>
    </>
  );
}
