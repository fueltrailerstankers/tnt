// The ZAR -> USD display rate. Pure.
// app_settings key 'fx.zar_usd' holds a positive decimal string: USD per 1 ZAR (e.g. "0.0543"). Anything else (missing,
// a number, zero, negative, exponent or junk) means "no rate", and the "≈ USD" line is not shown. Never hard-code one.

export const FX_SETTING_KEY = 'fx.zar_usd';

const DECIMAL = /^\d{1,6}(\.\d{1,12})?$/;

/** USD per 1 ZAR from the stored setting value, or null. */
export function parseFxRate(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!DECIMAL.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}
