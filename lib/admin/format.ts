// Display helpers for the Xero mirror. Pure.
export function formatMoney(amount: number | string | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  const code = currency && /^[A-Z]{3}$/.test(currency.trim()) ? currency.trim() : null;
  return code
    ? new Intl.NumberFormat('en-ZA', { style: 'currency', currency: code, minimumFractionDigits: 2 }).format(n)
    : new Intl.NumberFormat('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

/** Search text safe to place inside a PostgREST or=() filter: no separators, wildcards or quotes. */
export function searchTerm(q: string | string[] | undefined): string | null {
  const s = (Array.isArray(q) ? q[0] : q ?? '').replace(/[,()*%"'\\:]/g, ' ').trim().slice(0, 60);
  return s || null;
}
