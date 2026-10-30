// Builder layout: the designer works on an ordered list of items (field + "same row as previous"); the spec's
// 24-column row/col/span are computed from it. Pure.
import type { FieldSpec } from '@/lib/spec/types';

export type Width = 'full' | 'half' | 'third' | 'quarter';
export const WIDTH_SPAN: Record<Width, number> = { full: 24, half: 12, third: 8, quarter: 6 };

export interface Item {
  field: FieldSpec;
  /** On the same row as the previous item (when it fits in 24 columns). */
  sameRow: boolean;
}

function colOf(f: FieldSpec): number {
  return 'col' in f && f.col ? f.col : 1;
}

export function spanOf(f: FieldSpec): number {
  return 'span' in f && f.span ? f.span : 24;
}

export function widthOf(f: FieldSpec): Width {
  const s = spanOf(f);
  return s <= 6 ? 'quarter' : s <= 8 ? 'third' : s <= 12 ? 'half' : 'full';
}

/** Spec fields -> designer items, in layout order (row, then column). */
export function toItems(fields: FieldSpec[]): Item[] {
  const sorted = [...fields].sort((a, b) => a.row - b.row || colOf(a) - colOf(b));
  return sorted.map((field, i) => ({ field, sameRow: i > 0 && field.type !== 'pagebreak' && sorted[i - 1].type !== 'pagebreak' && sorted[i - 1].row === field.row }));
}

/** Designer items -> spec fields with row/col/span. A page break always has a row of its own. */
export function fromItems(items: Item[]): FieldSpec[] {
  const out: FieldSpec[] = [];
  let row = 0;
  let used = 24;
  let prevBreak = true;
  for (const it of items) {
    const f = it.field;
    if (f.type === 'pagebreak') {
      row += 1;
      used = 24;
      prevBreak = true;
      out.push({ ...f, row });
      continue;
    }
    const span = spanOf(f);
    if (it.sameRow && !prevBreak && used + span <= 24) {
      out.push({ ...f, row, col: used + 1, span } as FieldSpec);
      used += span;
    } else {
      row += 1;
      out.push({ ...f, row, col: 1, span } as FieldSpec);
      used = span;
    }
    prevBreak = false;
  }
  return out;
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

export function setWidth(field: FieldSpec, w: Width): FieldSpec {
  if (field.type === 'pagebreak') return field;
  return { ...field, span: WIDTH_SPAN[w] } as FieldSpec;
}
