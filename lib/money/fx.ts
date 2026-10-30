// Money display. Xero-sourced money is ZAR and always shows with its currency; portal money displays in USD. Pure.
// Format follows the design: "R 486,750.00" and "$26,450.00" (comma grouping, dot decimal, 2 dp). Note that the
// en-ZA locale would print "R 486 750,00", which is why grouping is done with en-US rather than the currency locale.
// There is no ZAR -> USD rate source yet (handoff "Still open"). Callers pass a rate only when one exists; never
// hard-code one. Without a rate, approxUsd() returns null and the "≈ USD" line is hidden.

export type AmountInput = number | string | null | undefined;

/** Shown for a missing amount. */
export const NO_AMOUNT = '—';

const GROUPED = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A finite number, or null for null, blank or non-numeric input. Accepts Postgres numeric strings. */
export function toAmount(v: AmountInput): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Upper-case ISO 4217 code, or `fallback` when the value is not a three-letter code. */
export function currencyCode(code: string | null | undefined, fallback = 'ZAR'): string {
  const c = (code ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : fallback;
}

/** Rounds to cents and splits the sign, so -0.001 prints as 0.00 rather than -0.00. */
function split(n: number): { sign: string; digits: string } {
  const cents = Math.round(n * 100) / 100;
  return { sign: cents < 0 ? '-' : '', digits: GROUPED.format(Math.abs(cents)) };
}

/** "R 486,750.00". */
export function formatZar(v: AmountInput): string {
  const n = toAmount(v);
  if (n === null) return NO_AMOUNT;
  const { sign, digits } = split(n);
  return `${sign}R ${digits}`;
}

/** "$26,450.00". */
export function formatUsd(v: AmountInput): string {
  const n = toAmount(v);
  if (n === null) return NO_AMOUNT;
  const { sign, digits } = split(n);
  return `${sign}$${digits}`;
}

/** ZAR and USD use their symbols; any other code is printed in front ("EUR 1,250.00"). */
export function formatAmount(v: AmountInput, currency: string | null | undefined): string {
  const code = currencyCode(currency);
  if (code === 'ZAR') return formatZar(v);
  if (code === 'USD') return formatUsd(v);
  const n = toAmount(v);
  if (n === null) return NO_AMOUNT;
  const { sign, digits } = split(n);
  return `${sign}${code} ${digits}`;
}

/**
 * Approximate USD for a ZAR amount. `rate` is USD per 1 ZAR. Null unless the amount is a number, the currency is
 * ZAR and the rate is a positive finite number. Rounded to cents.
 */
export function approxUsd(amount: AmountInput, currency: string | null | undefined, rate: number | null | undefined): number | null {
  const n = toAmount(amount);
  if (n === null) return null;
  if (currencyCode(currency, '') !== 'ZAR') return null;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
  const usd = Math.round(n * rate * 100) / 100;
  return Object.is(usd, -0) ? 0 : usd;
}
