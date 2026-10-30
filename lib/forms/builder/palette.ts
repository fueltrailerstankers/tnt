// Builder palette: every Part A field type, with a sensible new field for each. Pure.
// table and checklist sections stay supported for the kit forms but are not offered (v1).
import type { FieldSpec } from '@/lib/spec/types';
import { fieldNameFromLabel } from './names';

export type PaletteType =
  | 'text' | 'textarea' | 'email' | 'phone' | 'url' | 'number' | 'currency' | 'date' | 'time' | 'datetime' | 'yesno'
  | 'choice' | 'name' | 'address' | 'file' | 'signature' | 'lookup' | 'rating' | 'section' | 'content' | 'pagebreak';

export const PALETTE: Array<{ type: PaletteType; label: string }> = [
  { type: 'text', label: 'Text' }, { type: 'textarea', label: 'Paragraph' }, { type: 'email', label: 'Email' },
  { type: 'phone', label: 'Phone' }, { type: 'url', label: 'Website' }, { type: 'number', label: 'Number' },
  { type: 'currency', label: 'Amount' }, { type: 'date', label: 'Date' }, { type: 'time', label: 'Time' },
  { type: 'datetime', label: 'Date and time' }, { type: 'yesno', label: 'Yes/No' }, { type: 'choice', label: 'Choice' },
  { type: 'name', label: 'Name' }, { type: 'address', label: 'Address' }, { type: 'file', label: 'File upload' },
  { type: 'signature', label: 'Signature' }, { type: 'lookup', label: 'Lookup' }, { type: 'rating', label: 'Rating' },
  { type: 'section', label: 'Section' }, { type: 'content', label: 'Text block' }, { type: 'pagebreak', label: 'Page break' },
];

/** A new field of a palette type. `taken` are the form's field names; row/col/span are set by the layout. */
export function newField(type: PaletteType, taken: Iterable<string>, lookupSource?: { form: string; field: string }): FieldSpec {
  const label = PALETTE.find((p) => p.type === type)?.label ?? 'Field';
  const name = fieldNameFromLabel(label, taken);
  const base = { name, label, row: 1, col: 1, span: 24 };
  switch (type) {
    case 'choice': return { ...base, type, style: 'dropdown', options: ['Option 1', 'Option 2'] };
    case 'name': return { ...base, type, parts: ['First', 'Last'] };
    case 'address': return { ...base, type, parts: ['Line1', 'Line2', 'City', 'State', 'PostalCode', 'Country'] };
    case 'file': return { ...base, type, multi: true, maxFiles: 10 };
    case 'signature': return { ...base, type, mode: 'draw' };
    case 'lookup': return { ...base, type, style: 'dropdown', lookup: { sourceForm: lookupSource?.form ?? '', displayField: lookupSource?.field ?? '' } };
    case 'section': return { name, label: 'Section', type: 'section', row: 1, col: 1, span: 24 };
    case 'content': return { type: 'content', html: '<p>Text shown on the form.</p>', row: 1, col: 1, span: 24 };
    case 'pagebreak': return { type: 'pagebreak', row: 1, nextButton: 'Next' };
    case 'yesno': return { ...base, type, style: 'radio' };
    case 'number': return { ...base, type };
    default: return { ...base, type } as FieldSpec;
  }
}

/** Types whose stored values can be read by another type once entries exist (guards.ts). */
const STRING_TYPES = new Set(['text', 'textarea', 'email', 'url']);
export function compatibleType(from: string, to: string): boolean {
  if (from === to) return true;
  return STRING_TYPES.has(from) && (to === 'text' || to === 'textarea');
}
