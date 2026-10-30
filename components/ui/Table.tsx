import Link from 'next/link';
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { UnreadDot } from './UnreadDot';

// Presentational table parts for admin lists (40-44px rows). State (selection, sorting, URL params) lives in the
// page or a client DataTable shell; these only render. Navigation uses real links, never a whole-row onclick.

export interface TableWrapProps {
  children: ReactNode;
  /** Names the scroll region; it then becomes keyboard-focusable so it can be scrolled without a mouse. */
  label?: string;
  /** Max height in px for a scrolling body; use with THead sticky. */
  maxHeight?: number;
  className?: string;
}

/** Horizontal (and optional vertical) scroll container. The page never scrolls sideways; the table does. */
export function TableWrap({ children, label, maxHeight, className = '' }: TableWrapProps) {
  return (
    <div
      role={label ? 'region' : undefined}
      aria-label={label}
      tabIndex={label ? 0 : undefined}
      style={maxHeight ? { maxHeight } : undefined}
      className={`overflow-x-auto ${maxHeight ? 'overflow-y-auto' : ''} ${className}`.trim()}
    >
      {children}
    </div>
  );
}

export function Table({ children, minWidth = 760, className = '', ...rest }: HTMLAttributes<HTMLTableElement> & { minWidth?: number }) {
  return (
    <table style={{ minWidth }} className={`w-full border-collapse text-body text-fg ${className}`.trim()} {...rest}>
      {children}
    </table>
  );
}

/** Header row group. `sticky` pins header cells to the top of a scrolling TableWrap. */
export function THead({ children, sticky = false }: { children: ReactNode; sticky?: boolean }) {
  return (
    <thead className={`text-left text-[12px] font-semibold leading-4 text-fg-muted [&_th]:bg-surface-2 ${sticky ? '[&_th]:sticky [&_th]:top-0 [&_th]:z-[1]' : ''}`}>
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

/** Column header. `numeric` right-aligns it over money and counts. */
export function TH({ children, className = '', numeric = false, checkbox = false, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; checkbox?: boolean }) {
  return (
    <th
      scope="col"
      className={`py-[9px] font-semibold first:pl-3.5 last:pr-3.5 ${checkbox ? 'w-10 px-3.5' : 'px-2'} ${numeric ? 'text-right' : 'text-left'} ${className}`.trim()}
      {...rest}
    >
      {children}
    </th>
  );
}

/** Body row. `selected` tints it accent-soft. */
export function TR({ children, selected = false, className = '', ...rest }: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr data-selected={selected || undefined} className={`border-t border-border ${selected ? 'bg-accent-soft' : 'hover:bg-surface-2'} ${className}`.trim()} {...rest}>
      {children}
    </tr>
  );
}

export interface TDProps extends TdHTMLAttributes<HTMLTableCellElement> {
  /** VIN, quote no, invoice no: JetBrains Mono 13px. */
  mono?: boolean;
  /** Dates and secondary text: muted, no wrap. */
  muted?: boolean;
  /** Money and counts: right-aligned tabular figures. */
  numeric?: boolean;
  checkbox?: boolean;
}

export function TD({ children, mono = false, muted = false, numeric = false, checkbox = false, className = '', ...rest }: TDProps) {
  const cls = [
    'h-[42px] py-0 align-middle first:pl-3.5 last:pr-3.5',
    checkbox ? 'w-10 px-3.5' : 'px-2',
    mono ? 'font-mono text-small' : '',
    muted ? 'whitespace-nowrap text-fg-muted' : '',
    numeric ? 'text-right tabular-nums' : '',
    className,
  ].filter(Boolean).join(' ');
  return <td className={cls} {...rest}>{children}</td>;
}

/** "#" cell: unread dot (or hollow read dot) plus the number, linking to the detail page. Unread numbers are bold. */
export function NumberCell({ number, href, unread = false }: { number: number | string; href?: string; unread?: boolean }) {
  const text = <span className={unread ? 'font-semibold' : undefined}>{number}</span>;
  return (
    <TD>
      <span className="inline-flex items-center gap-2">
        <UnreadDot read={!unread} />
        {href ? <Link href={href} className="text-fg no-underline hover:underline">{text}</Link> : text}
      </span>
    </TD>
  );
}

/** A full-width row for an EmptyState or a loading note. */
export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr className="border-t border-border">
      <td colSpan={colSpan} className="p-0">{children}</td>
    </tr>
  );
}
