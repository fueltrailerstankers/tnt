// Page and row layout from the spec's 24-column grid. Pure.
// A pagebreak closes the page above it: its nextButton is that page's button (the last one is "Submit"),
// its pageTitle titles that page, and showBackButton/backButton apply to that page.
import type { FieldSpec, FormSpec, PageBreakField } from './types';

export interface Cell {
  field: Exclude<FieldSpec, PageBreakField>;
  col: number;
  span: number;
}
export interface Row {
  row: number;
  cells: Cell[];
}
export interface Page {
  index: number;
  title?: string;
  nextButton: string;
  backButton?: string;
  rows: Row[];
}

export function pages(spec: FormSpec): Page[] {
  const out: Page[] = [];
  let current: Cell[] = [];
  const sorted = [...spec.fields].sort((a, b) => a.row - b.row || colOf(a) - colOf(b));
  for (const f of sorted) {
    if (f.type === 'pagebreak') {
      out.push(makePage(out.length, current, f));
      current = [];
    } else {
      current.push({ field: f, col: colOf(f), span: 'span' in f && f.span ? f.span : 24 });
    }
  }
  if (current.length) out.push(makePage(out.length, current, { type: 'pagebreak', row: 0, nextButton: 'Submit' }));
  return out;
}

function colOf(f: FieldSpec): number {
  return 'col' in f && f.col ? f.col : 1;
}

function makePage(index: number, cells: Cell[], brk: PageBreakField): Page {
  const byRow = new Map<number, Cell[]>();
  for (const c of cells) {
    const list = byRow.get(c.field.row) ?? [];
    list.push(c);
    byRow.set(c.field.row, list);
  }
  return {
    index,
    title: brk.pageTitle,
    nextButton: brk.nextButton,
    backButton: brk.showBackButton ? (brk.backButton ?? 'Back') : undefined,
    rows: [...byRow.entries()].sort(([a], [b]) => a - b).map(([row, list]) => ({ row, cells: list })),
  };
}
