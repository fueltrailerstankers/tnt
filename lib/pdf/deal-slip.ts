// Field blocks of the Cognito DEAL template (#3). Pure, shared by DealPdf.tsx and tests.
import { displayValue, type EntryData } from '@/lib/spec/values';

const SLIP_FIELDS: Array<[string, string, boolean]> = [
  ['MONTH', 'MONTH', false],
  ['DATECREATED', 'DATE CREATED', false],
  ['COLLECTIONLOCATION', 'COLLECTION LOCATION', true],
  ['QUOTENO', 'QUOTE NO', false],
  ['SALESREP', 'SALES REP', false],
  ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((n): Array<[string, string, boolean]> => [[`PARTNO${n}`, `PART NO ${n}`, false], [`LINE${n}`, `LINE ${n}`, false]]),
];

/** Field blocks the slip prints for an entry, in template order. Pure (unit-tested). */
export function dealSlipBlocks(data: EntryData): Array<{ label: string; value: string; wide: boolean }> {
  return SLIP_FIELDS.flatMap(([key, label, wide]) => {
    const raw = data[key];
    const value = Array.isArray(raw) ? raw.map(String).filter(Boolean).join('\n') : displayValue(raw);
    return value ? [{ label, value, wide }] : [];
  });
}
