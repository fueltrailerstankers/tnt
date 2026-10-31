// Factory dispatch (stock plan 5.4 / 7.4): form input, Find unit outcomes, error placement, copy. Pure.
// The server actions in app/(admin)/admin/stock/dispatch/actions.ts validate with parseDispatch, call the
// stock_dispatch_unit / stock_move_unit RPCs as the signed-in user, and map RPC errors with lib/stock/errors.ts.

import { z } from 'zod';
import { MAX_ACCESSORIES, MAX_ACCESSORY_LENGTH } from './deal';
import { dealFoundMessage, stockErrorMessage, STOCK_COPY, type StockError } from './errors';
import { isValidVin, normalizeVin } from './vin';

export const DISPATCH_MODES = ['free', 'deal'] as const;
export type DispatchMode = (typeof DISPATCH_MODES)[number];
export const MAX_NOTES = 2000;
export const ACCESSORY_FIELDS = Array.from({ length: MAX_ACCESSORIES }, (_, i) => `accessory_${i + 1}`);

/** Fixed copy from the stock plan 7.4 (and the inferred additions). */
export const DISPATCH_COPY = {
  eyebrow: 'FACTORY TO BRANCH',
  title: 'Dispatch a unit',
  subtitle: 'Add a VIN, confirm the equipment and choose its destination.',
  unitDetails: 'Unit details',
  modeFree: 'Without sequence number',
  modeDeal: 'Existing sequence number',
  dealYear: 'Deal year',
  sequence: 'Sequence number',
  sequencePlaceholder: 'e.g. 259',
  find: 'Find unit',
  findFirst: 'Find the deal first.',
  model: 'Model / part number',
  modelPlaceholder: 'Choose a model',
  vin: 'VIN',
  vinPlaceholder: 'Enter the full VIN',
  destination: 'Destination branch',
  destinationPlaceholder: 'Choose a branch',
  date: 'Dispatch date',
  accessoriesTitle: 'Fitted products & accessories',
  accessoriesHint: 'Ten optional lines. Record the equipment fitted to this individual unit.',
  accessoryPlaceholder: 'Product or accessory',
  notes: 'Dispatch notes',
  notesPlaceholder: 'Delivery or unit notes',
  submit: 'Complete dispatch →',
  factoryNotWithDeal: 'not with a deal',
  moveKeeps: 'The unit keeps the model, accessories and notes recorded at the Factory.',
  modelNotRecognised: 'Model not recognised on the DEAL: choose the model.',
} as const;

/** "Move this factory unit to {branch}" (stock plan 5.4, inferred). */
export const moveOfferLabel = (branch: string) => `Move this factory unit to ${branch}`;

/** Model select option: "PART — description". */
export const modelOptionLabel = (part: string, description: string) => `${part} — ${description}`;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return y >= 2000 && y <= 2100 && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Where an error shows on the form. */
export type DispatchField = 'mode' | 'deal' | 'model' | 'vin' | 'location' | 'dispatch_date' | 'accessories' | 'notes' | 'form';

const invalid = (field: string) => stockErrorMessage({ code: 'INVALID_INPUT', detail: { field } });

/** The message shown for a form field the server rejected before calling the RPC (same copy as the RPC errors). */
export function fieldMessage(field: DispatchField): string {
  switch (field) {
    case 'model': return stockErrorMessage({ code: 'MODEL_NOT_FOUND', detail: {} });
    case 'location': return stockErrorMessage({ code: 'LOCATION_NOT_FOUND', detail: {} });
    case 'vin': return invalid('vin');
    case 'dispatch_date': return invalid('dispatch_date');
    case 'deal': return invalid('deal');
    case 'accessories': return invalid('accessories');
    case 'notes': return invalid('notes');
    default: return invalid('form');
  }
}

const intOrNull = z.preprocess((v) => {
  const s = typeof v === 'string' ? v.trim() : v;
  return s === '' || s === undefined || s === null ? null : Number(s);
}, z.number().int().nullable());

const DispatchSchema = z.object({
  mode: z.enum(DISPATCH_MODES),
  deal_year: intOrNull.pipe(z.number().min(2000).max(2100).nullable()),
  deal_number: intOrNull.pipe(z.number().min(1).max(2_147_483_647).nullable()),
  model: z.string().trim().min(1).max(40),
  vin: z.string().max(80).refine((v) => isValidVin(v)),
  location: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,15}$/),
  dispatch_date: z.string().trim().refine(isIsoDate),
  accessories: z.array(z.string().max(MAX_ACCESSORY_LENGTH)).max(MAX_ACCESSORIES),
  notes: z.string().max(MAX_NOTES),
});

export interface DispatchValues {
  mode: DispatchMode;
  /** Both set in deal mode, both null in free mode. */
  dealYear: number | null;
  dealNumber: number | null;
  model: string;
  /** Normalised (upper case, no spaces or invisible characters). */
  vin: string;
  location: string;
  dispatchDate: string;
  /** Trimmed, non-empty lines in order. */
  accessories: string[];
  notes: string | null;
}

export type DispatchParse = { ok: true; value: DispatchValues } | { ok: false; field: DispatchField; message: string };

/** Validates the dispatch form (FormData read into strings). The RPC re-checks everything. */
export function parseDispatch(raw: Record<string, string | undefined>): DispatchParse {
  const r = DispatchSchema.safeParse({
    mode: raw.mode,
    deal_year: raw.mode === 'deal' ? raw.deal_year ?? '' : '',
    deal_number: raw.mode === 'deal' ? raw.deal_number ?? '' : '',
    model: raw.model ?? '',
    vin: raw.vin ?? '',
    location: raw.location ?? '',
    dispatch_date: raw.dispatch_date ?? '',
    accessories: ACCESSORY_FIELDS.map((k) => raw[k] ?? ''),
    notes: raw.notes ?? '',
  });
  if (!r.success) {
    const key = String(r.error.issues[0]?.path[0] ?? 'form');
    const field: DispatchField = key === 'deal_year' || key === 'deal_number' ? 'deal'
      : (['mode', 'model', 'vin', 'location', 'dispatch_date', 'accessories', 'notes'] as const).find((f) => f === key) ?? 'form';
    return { ok: false, field, message: fieldMessage(field) };
  }
  const v = r.data;
  if (v.mode === 'deal' && (v.deal_year === null || v.deal_number === null)) return { ok: false, field: 'deal', message: fieldMessage('deal') };
  const notes = v.notes.trim();
  return {
    ok: true,
    value: {
      mode: v.mode,
      dealYear: v.mode === 'deal' ? v.deal_year : null,
      dealNumber: v.mode === 'deal' ? v.deal_number : null,
      model: v.model.replace(/\s/g, '').toUpperCase(),
      vin: normalizeVin(v.vin)!,
      location: v.location,
      dispatchDate: v.dispatch_date,
      accessories: v.accessories.map((a) => a.trim()).filter(Boolean),
      notes: notes || null,
    },
  };
}

/** stock_dispatch_unit arguments. */
export function dispatchRpcArgs(orgId: string, v: DispatchValues) {
  return {
    p_org: orgId, p_vin: v.vin, p_model: v.model, p_location: v.location, p_date: v.dispatchDate,
    p_accessories: v.accessories, p_notes: v.notes, p_deal_year: v.dealYear, p_deal_number: v.dealNumber,
  };
}

/** Which field an RPC error belongs to (VIN errors show under the VIN, deal errors under Find unit). */
export function errorField(e: StockError): DispatchField {
  switch (e.code) {
    case 'VIN_EXISTS':
    case 'FACTORY_UNIT_EXISTS':
      return 'vin';
    case 'MODEL_NOT_FOUND':
      return 'model';
    case 'LOCATION_NOT_FOUND':
      return 'location';
    case 'DEAL_NOT_FOUND':
    case 'DEAL_DISMISSED':
    case 'DEAL_ALREADY_DISPATCHED':
      return 'deal';
    case 'INVALID_INPUT': {
      const f = e.detail.field;
      if (f === 'vin' || f === 'accessories' || f === 'notes' || f === 'dispatch_date' || f === 'deal') return f;
      if (f === 'location') return 'location';
      return 'form';
    }
    default:
      return 'form';
  }
}

/** A stock_deals row as Find unit reads it. */
export interface FoundDealRow {
  year: number;
  number: number;
  status: 'awaiting_dispatch' | 'dispatched' | 'dismissed';
  model_part: string | null;
  location_id: string | null;
  accessories: string[] | null;
  quote_number: string | null;
}

export interface DealPrefill {
  year: number;
  number: number;
  model: string | null;
  location: string | null;
  accessories: string[];
  quoteNumber: string | null;
}

export type FindOutcome =
  | { kind: 'found'; message: string; deal: DealPrefill }
  | { kind: 'dismissed' | 'dispatched' | 'not_found'; message: string; year: number; number: number };

/**
 * Find unit (stock plan 5.4): found and outstanding -> prefill; dismissed -> blocked; already dispatched -> blocked
 * (with the VIN it went out with); not found.
 */
export function findOutcome(
  year: number, number: number, deal: FoundDealRow | null,
  opts: { unitVin?: string | null; locationName?: (id: string) => string | undefined; restorer?: string } = {},
): FindOutcome {
  if (!deal) return { kind: 'not_found', year, number, message: stockErrorMessage({ code: 'DEAL_NOT_FOUND', detail: {} }) };
  if (deal.status === 'dismissed') {
    return { kind: 'dismissed', year, number, message: stockErrorMessage({ code: 'DEAL_DISMISSED', detail: {} }, { restorer: opts.restorer }) };
  }
  if (deal.status === 'dispatched') {
    return {
      kind: 'dispatched', year, number,
      message: stockErrorMessage({ code: 'DEAL_ALREADY_DISPATCHED', detail: { year: deal.year, number: deal.number, vin: opts.unitVin ?? null } }),
    };
  }
  const branch = deal.location_id ? opts.locationName?.(deal.location_id) ?? deal.location_id : null;
  return {
    kind: 'found',
    message: dealFoundMessage({ year: deal.year, number: deal.number, model: deal.model_part, branch }),
    deal: {
      year: deal.year, number: deal.number, model: deal.model_part, location: deal.location_id,
      accessories: (deal.accessories ?? []).slice(0, MAX_ACCESSORIES), quoteNumber: deal.quote_number,
    },
  };
}

/**
 * Whether a Find unit result still belongs to the typed deal year and sequence number (compared as numbers, so
 * "0260" is 260). Only a found deal that still matches enables Complete dispatch.
 */
export function findMatches(find: { kind: string; deal?: { year: number; number: number } } | null, year: string, number: string): boolean {
  if (find?.kind !== 'found' || !find.deal) return false;
  const q = dealQuery(year, number);
  return !!q && q.year === find.deal.year && q.number === find.deal.number;
}

/** Year and number from the query string (?year=&number=), or null when either is missing or invalid. */
export function dealQuery(year: string | string[] | undefined, number: string | string[] | undefined): { year: number; number: number } | null {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const y = one(year).trim();
  const n = one(number).trim();
  if (!/^\d{4}$/.test(y) || !/^\d{1,9}$/.test(n)) return null;
  const yy = Number(y);
  const nn = Number(n);
  return yy >= 2000 && yy <= 2100 && nn > 0 ? { year: yy, number: nn } : null;
}

/** An existing unit with the typed VIN (VIN check on blur): an error, or a note when it can be moved from the Factory. */
export interface VinUnitRow {
  vin_norm: string;
  model_part: string;
  sequence: number | null;
  location_id: string;
  status: string;
}

export function vinCheck(
  unit: VinUnitRow | null, atFactory: boolean, locationName: (id: string) => string | undefined,
): { tone: 'error' | 'info'; message: string } | null {
  if (!unit) return null;
  if (atFactory && unit.status !== 'sold') {
    return { tone: 'info', message: 'This VIN is already registered at the Factory. Choose a destination branch to move it.' };
  }
  return {
    tone: 'error',
    message: stockErrorMessage({
      code: 'VIN_EXISTS',
      detail: { model: unit.model_part, sequence: unit.sequence, location: unit.location_id, location_name: locationName(unit.location_id) ?? null, status: unit.status },
    }),
  };
}

export const SAVED_KINDS = ['dispatch', 'move'] as const;
export type SavedKind = (typeof SAVED_KINDS)[number];

/** Confirmation shown on the Units page after a redirect (?saved=dispatch|move). */
export const SAVED_NOTICE: Record<SavedKind, string> = {
  dispatch: STOCK_COPY.dispatchSaved,
  move: 'Factory unit moved to its branch.',
};

export function savedNotice(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && (SAVED_KINDS as readonly string[]).includes(s) ? SAVED_NOTICE[s as SavedKind] : null;
}

/** After a dispatch or a move: the Units register searched for the VIN, with the confirmation. */
export function savedUrl(vin: string, kind: SavedKind): string {
  return `/admin/stock/units?${new URLSearchParams({ q: vin, saved: kind })}`;
}

/** Deals page "Dispatch →" target: dispatch in existing-sequence mode, prefilled. */
export function dispatchHref(year: number, number: number): string {
  return `/admin/stock/dispatch?${new URLSearchParams({ year: String(year), number: String(number) })}`;
}
