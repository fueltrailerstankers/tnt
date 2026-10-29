// DEAL entry -> stock deal (docs/M6.md section 3). Pure. The deal sync job decrypts the DEAL entry, calls
// dealFromEntry and upserts the result into stock_deals (unique per org on entry_id and on year + number).
// No personal data is carried over: the customer stays in the encrypted entry.

import { partKey } from './models';

/** COLLECTION LOCATION option -> stock location id. The DEAL form says DUR; stock uses DBN. */
export const DEAL_LOCATION_MAP: Readonly<Record<string, string>> = { JHB: 'JHB', DUR: 'DBN', DBN: 'DBN', CPT: 'CPT' };
export const DEAL_LINE_COUNT = 8;
export const MAX_ACCESSORIES = 10;
export const MAX_ACCESSORY_LENGTH = 200;
export const MODEL_NOT_RECOGNISED = 'Model not recognised';
const TZ = 'Africa/Johannesburg';

export interface DealEntryMeta {
  id: string;
  /** DEAL entry number: the stock "sequence number" (ASSUMPTION confirmed in docs/M6.md section 9 q5). */
  number: number;
  /** entries.created_at (UTC ISO). */
  created_at: string;
}

/** Column values for stock_deals (status, unit and dismissal fields are left to the RPCs). */
export interface StockDealFields {
  entry_id: string;
  year: number;
  number: number;
  location_id: string | null;
  /** Canonical model part number, or null: "Model not recognised", dispatch asks for the model. */
  model_part: string | null;
  quote_number: string | null;
  accessories: string[];
}

const text = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s || null;
};

const validYear = (y: number) => Number.isInteger(y) && y >= 2000 && y <= 2100;

/** Calendar year of an instant in Africa/Johannesburg. */
export function johannesburgYear(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric' }).format(d));
}

/**
 * Deal year: the year of DATE CREATED ("YYYY-MM-DD" as stored by the form engine; a full timestamp is read in
 * Africa/Johannesburg). Falls back to the entry's created date in Africa/Johannesburg.
 */
export function dealYear(dateCreated: unknown, entryCreatedAt: string): number {
  const s = text(dateCreated);
  if (s) {
    const dateOnly = /^(\d{4})-\d{2}-\d{2}$/.exec(s);
    const y = dateOnly ? Number(dateOnly[1]) : /^\d{4}-\d{2}-\d{2}T/.test(s) ? johannesburgYear(s) : null;
    if (y !== null && validYear(y)) return y;
  }
  const fallback = johannesburgYear(entryCreatedAt);
  if (fallback === null || !validYear(fallback)) throw new Error('Deal year could not be determined');
  return fallback;
}

/** First COLLECTION LOCATION value that maps to a stock location (checkboxes store an array). */
export function dealLocation(v: unknown): string | null {
  const values = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;]/) : [];
  for (const x of values) {
    if (typeof x !== 'string') continue;
    const id = DEAL_LOCATION_MAP[x.trim().toUpperCase()];
    if (id) return id;
  }
  return null;
}

/** First PARTNO1..8 matching a model part number (case and space insensitive), with its line number. */
export function detectModel(data: Record<string, unknown>, modelParts: readonly string[]): { modelPart: string | null; line: number | null } {
  const known = new Map(modelParts.map((p) => [partKey(p), p]));
  for (let i = 1; i <= DEAL_LINE_COUNT; i++) {
    const k = partKey(text(data[`PARTNO${i}`]));
    if (k && known.has(k)) return { modelPart: known.get(k)!, line: i };
  }
  return { modelPart: null, line: null };
}

export function dealFromEntry(data: Record<string, unknown>, entry: DealEntryMeta, modelParts: readonly string[]): StockDealFields {
  const { modelPart, line } = detectModel(data, modelParts);
  const accessories: string[] = [];
  for (let i = 1; i <= DEAL_LINE_COUNT && accessories.length < MAX_ACCESSORIES; i++) {
    if (i === line) continue;
    const t = text(data[`LINE${i}`]);
    if (t) accessories.push(t.slice(0, MAX_ACCESSORY_LENGTH));
  }
  const quote = text(data.QUOTENO);
  return {
    entry_id: entry.id,
    year: dealYear(data.DATECREATED, entry.created_at),
    number: entry.number,
    location_id: dealLocation(data.COLLECTIONLOCATION),
    model_part: modelPart,
    quote_number: quote ? quote.slice(0, 50) : null,
    accessories,
  };
}
