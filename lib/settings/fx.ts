// Manual ZAR -> USD rate (Settings > Organisation). Pure.
//
// Stored in app_settings under FX_SETTING_KEY as a JSON string holding a positive decimal: USD per 1 ZAR
// (e.g. "0.0547" means R 1 = $0.0547). A string, not a number, so the exact text the admin typed is kept. Missing
// or invalid means "no rate": screens then show ZAR only and never a made-up "≈ USD" line (lib/money/fx approxUsd).

export const FX_SETTING_KEY = 'fx.zar_usd';

/** Upper bound for a sane USD-per-ZAR rate (a rand has never been worth more than a dollar). */
export const FX_MAX = 1;

const DECIMAL = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,8})?$/;

export type FxParse = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * Validates what the admin typed. Blank clears the rate (value null). Otherwise a plain positive decimal with up to
 * 8 decimal places, not above FX_MAX. No signs, exponents, commas or spaces inside: the text is stored as typed,
 * apart from surrounding whitespace.
 */
export function parseFxInput(input: unknown): FxParse {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== 'string') return { ok: false, error: 'Enter the rate as a number, e.g. 0.0547.' };
  const s = input.trim();
  if (s === '') return { ok: true, value: null };
  if (s.length > 16 || !DECIMAL.test(s)) return { ok: false, error: 'Enter the rate as a number, e.g. 0.0547 (up to 8 decimals).' };
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'The rate must be more than 0.' };
  if (n > FX_MAX) return { ok: false, error: 'That is more than $1 per R 1. Enter USD per 1 ZAR, e.g. 0.0547.' };
  return { ok: true, value: s };
}

/** The stored setting as a number, or null when missing or not a valid positive decimal string. */
export function fxRateOf(stored: unknown): number | null {
  if (typeof stored !== 'string') return null;
  const p = parseFxInput(stored);
  return p.ok && p.value !== null ? Number(p.value) : null;
}

/** The stored setting as the text to show in the form ('' when none or invalid). */
export function fxInputValue(stored: unknown): string {
  return fxRateOf(stored) === null ? '' : (stored as string).trim();
}

/** "R 1 = $0.0547" for the settings page; null when no rate. */
export function fxLabel(stored: unknown): string | null {
  return fxRateOf(stored) === null ? null : `R 1 = $${(stored as string).trim()}`;
}
