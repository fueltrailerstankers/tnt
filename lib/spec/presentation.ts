// How a form is shown: steps, section cards and display rows. Pure, data only.
// The spec stays the source of truth for fields, names, labels, order of entry data and validation; this module
// only groups and widens cells for the screen (UI handoff: 24-column grid, cards, steps). Every input field of
// the spec appears exactly once (tests/unit/presentation.test.ts enforces it for all seven forms).
import { pages, type Cell, type Row } from './layout';
import type { FormSpec } from './types';

export type SectionKind = 'grid' | 'lines' | 'count';

export interface DisplayCell {
  cell: Cell;
  /** Columns of 24 on screens >= 640px; one column below. */
  span: number;
  /** Display label for this screen only (the spec label stays the field's label everywhere else). */
  label?: string;
}

export interface DisplayRow {
  cells: DisplayCell[];
}

export interface Section {
  key: string;
  title?: string;
  description?: string;
  kind: SectionKind;
  rows: DisplayRow[];
}

export interface Step {
  index: number;
  /** Shown in the step header and progress; also the fieldset's accessible name. */
  title?: string;
  nextButton: string;
  backButton?: string;
  sections: Section[];
  /** Signature fields that must be captured before Next (handoff: each step blocks Next until signed). */
  requireSigned: string[];
  /** Content cell that must be scrolled to the end before a signature unlocks (handoff rule 12). */
  gate?: { content: string; signature: string };
  /** Last step of a long flow shows a review of what was entered. */
  review?: boolean;
}

/** id of a cell: the field name, or content@<row> for unnamed content blocks. */
export function cellId(c: Cell): string {
  return 'name' in c.field && c.field.name ? c.field.name : `content@${c.field.row}`;
}

type Ref = string | [id: string, span: number] | [id: string, span: number, label: string];
interface SectionDef {
  title?: string;
  description?: string;
  kind?: SectionKind;
  rows: Ref[][];
}
interface StepDef {
  title: string;
  sections: SectionDef[];
  requireSigned?: string[];
  gate?: { content: string; signature: string };
  review?: boolean;
}
interface FormPresentation {
  /** Steps for a form whose spec is one page. */
  steps?: StepDef[];
  /** Section cards for a form whose spec is one page (one step). */
  sections?: SectionDef[];
  /** Applies to every spec page when neither steps nor sections are given. */
  kind?: SectionKind;
}

const pairs = (n: number): Ref[][] => Array.from({ length: n }, (_, i) => [`PARTNO${i + 1}`, `LINE${i + 1}`]);

export const PRESENTATIONS: Record<string, FormPresentation> = {
  deal: {
    sections: [
      {
        title: 'Deal details',
        rows: [
          [['MONTH', 4], ['DATECREATED', 6], ['COLLECTIONLOCATION', 8], ['SALESREP', 6]],
          [['QUOTENO', 12], ['POP', 12]],
        ],
      },
      // The lines table ends with the manual Total (it overrides an imported total).
      { title: 'Lines', description: 'Up to 8 part number and description pairs.', kind: 'lines', rows: [...pairs(8), ['Total']] },
    ],
  },
  'request-for-invoice': {
    sections: [
      { title: 'Quote', rows: [[['QuoteNo', 8], ['DATE', 8], ['SalesRep', 8]]] },
      {
        title: 'Customer',
        rows: [
          [['Name', 12], ['IDNO', 12]],
          [['CONTACTNO', 8], ['CostomerVatNo', 8], ['BusinessRegNo', 8]],
          [['Address', 24]],
        ],
      },
      {
        title: 'Payments',
        description: 'Upload proof of each payment as a PDF or photo.',
        rows: [
          [['_1stDeposit', 12], ['_2ndDeposit', 12]],
          [['_3rdDeposit', 12], ['_4thPayment', 12]],
        ],
      },
    ],
  },
  'trailer-inspection-checklist': {
    sections: [
      {
        title: 'Trailer and inspector',
        rows: [
          [['TRAILERVINNUMBER', 12], ['_1STDATEINSPECTION', 12]],
          [['InspectedByName', 12], ['InspectorEmail', 12]],
        ],
      },
      { rows: [[['TrailerInspectionResults', 24]]] },
      { title: 'Sign-off', rows: [[['InspectorSignature', 12], ['InspectionDate', 12]]] },
    ],
  },
  // Handoff section 3: phone-first 5-step flow in the current Cognito order; each step blocks Next until signed.
  'delivery-note': {
    steps: [
      {
        title: 'Trailer and customer',
        sections: [
          {
            title: 'Trailer and customer',
            description: 'Find the quote to show the customer from the Request For Invoice.',
            rows: [[['TrailerVinNO', 12], ['QuoteNo', 12]], [['CustomerDetailsFromQuote', 24]], [['INVOICENO', 12]]],
          },
        ],
      },
      {
        title: 'Terms and warranty',
        requireSigned: ['Signature4', 'Signature'],
        gate: { content: 'content@4', signature: 'Signature4' },
        sections: [
          {
            title: 'Standard trading terms and warranty',
            description: 'Read the terms to the end, then sign.',
            rows: [[['content@4', 24]], [['Signature4', 24, 'Customer signature 1 of 4']]],
          },
          { title: 'Signatory declaration', rows: [[['content@5', 24]], [['Signature', 24, 'Customer signature 2 of 4']]] },
        ],
      },
      {
        title: 'Waiver and receipt',
        requireSigned: ['Signature2', 'Signature3'],
        sections: [
          { title: 'Polyurethane tanks waiver', rows: [[['content@6', 24]], [['Signature2', 24, 'Customer signature 3 of 4']]] },
          { title: 'Proof of receipt', rows: [[['content@8', 24]], [['Signature3', 24, 'Customer signature 4 of 4']]] },
        ],
      },
      {
        title: 'Documents and delivery',
        requireSigned: ['SalesRepSignature'],
        sections: [
          { title: 'Documents', rows: [[['COPYOfSignatoryID', 12], ['NATIS', 12]], [['PAYMENT', 12], ['Payment2', 12]], [['RELEASENOTE', 12]]] },
          { title: 'Delivery', rows: [[['DeliveryDate', 12], ['Email', 12]], [['SalesRepSignature', 24, 'Sales rep signature']]] },
        ],
      },
      {
        title: 'Photos and review',
        review: true,
        sections: [
          {
            title: 'Trailer photos',
            description: 'One photo of each side of the trailer.',
            rows: [[['Pic1FRONT', 12], ['PIC2LEFT', 12]], [['PIC3RIGHT', 12], ['Pic4REAR', 12]]],
          },
        ],
      },
    ],
  },
  'store-room': { kind: 'count' },
};

const PACKABLE = new Set(['text', 'email', 'date', 'number', 'choice', 'lookup', 'file', 'textarea']);

/**
 * Packs consecutive narrow rows into one display row (Cognito put many half-width fields on rows of their own,
 * which left the right half of the form empty). A row is narrow when it uses half the grid or less and holds
 * only simple inputs. Merged rows are widened to fill the 24 columns; order is unchanged.
 */
export function packRows(rows: Row[]): DisplayRow[] {
  const out: Array<{ cells: Cell[]; total: number; narrow: boolean; merged: boolean }> = [];
  for (const r of rows) {
    const total = r.cells.reduce((n, c) => n + c.span, 0);
    const narrow = total <= 12 && r.cells.every((c) => PACKABLE.has(c.field.type));
    const last = out[out.length - 1];
    if (narrow && last?.narrow && last.total + total <= 24) {
      last.cells.push(...r.cells);
      last.total += total;
      last.merged = true;
    } else {
      out.push({ cells: [...r.cells], total, narrow, merged: false });
    }
  }
  return out.map((r) => ({ cells: r.merged ? widen(r.cells, r.total) : r.cells.map((cell) => ({ cell, span: cell.span })) }));
}

function widen(cells: Cell[], total: number): DisplayCell[] {
  let used = 0;
  return cells.map((cell, i) => {
    const span = i === cells.length - 1 ? 24 - used : Math.max(1, Math.round((cell.span * 24) / total));
    used += span;
    return { cell, span };
  });
}

/** Steps, sections and rows for a form. Falls back to the spec pages with packed rows. */
export function present(spec: FormSpec): Step[] {
  const specPages = pages(spec);
  const def = PRESENTATIONS[spec.slug];
  const single = specPages.length === 1;

  if (def && single && (def.steps || def.sections)) {
    const byId = new Map<string, Cell>();
    for (const r of specPages[0].rows) for (const c of r.cells) byId.set(cellId(c), c);
    const used = new Set<string>();
    const section = (s: SectionDef, key: string): Section => ({
      key,
      title: s.title,
      description: s.description,
      kind: s.kind ?? 'grid',
      rows: s.rows
        .map((row) => ({
          cells: row.flatMap((ref) => {
            const [id, span, label] = typeof ref === 'string' ? [ref, undefined, undefined] : ref;
            const cell = byId.get(id);
            if (!cell || used.has(id)) return [];
            used.add(id);
            return [{ cell, span: span ?? cell.span, label }];
          }),
        }))
        .filter((r) => r.cells.length),
    });
    const stepDefs: StepDef[] = def.steps ?? [{ title: specPages[0].title ?? '', sections: def.sections! }];
    const steps: Step[] = stepDefs.map((s, i) => ({
      index: i,
      title: s.title || undefined,
      nextButton: i === stepDefs.length - 1 ? specPages[0].nextButton : 'Next',
      backButton: i > 0 ? 'Back' : specPages[0].backButton,
      sections: s.sections.map((x, j) => section(x, `${i}-${j}`)),
      requireSigned: s.requireSigned ?? [],
      gate: s.gate,
      review: s.review,
    }));
    // Anything the map does not place (a spec change) still shows, at the end of the last step.
    const rest = specPages[0].rows.map((r) => ({ ...r, cells: r.cells.filter((c) => !used.has(cellId(c))) })).filter((r) => r.cells.length);
    if (rest.length) {
      const last = steps[steps.length - 1];
      last.sections.push({ key: `${last.index}-rest`, kind: 'grid', rows: packRows(rest) });
    }
    return steps;
  }

  return specPages.map((p) => ({
    index: p.index,
    title: p.title,
    nextButton: p.nextButton,
    backButton: p.backButton,
    sections: [{ key: `${p.index}-0`, kind: def?.kind ?? 'grid', rows: def?.kind === 'count' ? p.rows.map((r) => ({ cells: r.cells.map((cell) => ({ cell, span: cell.span })) })) : packRows(p.rows) }],
    requireSigned: [],
  }));
}

/** Step that holds a field, for jumping to the first error. -1 when not found. */
export function stepOf(steps: Step[], name: string): number {
  return steps.findIndex((s) => s.sections.some((sec) => sec.rows.some((r) => r.cells.some((c) => cellId(c.cell) === name))));
}

/** Minimum stock level written in a Store Room label ("... MIN 50", "... MOQ 12", "... MIN ON SHELF 10"). */
export function minimumOf(label: string): number | null {
  const m = /\b(?:MIN(?:\s+ON\s+SHELF)?|MOQ)\s*(\d+)\s*$/i.exec(label.trim());
  return m ? Number(m[1]) : null;
}

/** How far a count is below its minimum; 0 when not below or not a number. */
export function shortBy(value: string | number | null | undefined, min: number | null): number {
  if (min === null || value === null || value === undefined || String(value).trim() === '') return 0;
  const n = Number(String(value).trim());
  return Number.isFinite(n) && n < min ? min - n : 0;
}
