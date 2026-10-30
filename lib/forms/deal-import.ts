// Form values for the DEAL "Import from Xero" button. Pure.

/**
 * Turns the quote mapping (lib/integrations/xero/write/plan-deal.ts) into the strings the form inputs take.
 * Lines 1..8 are always present so a shorter quote clears leftover lines. The DEAL Total field takes whole
 * numbers only (spec: integer), so a total with cents is rounded to the nearest whole number.
 */
export function dealImportFields(target: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 1; i <= 8; i++) {
    out[`PARTNO${i}`] = String(target[`PARTNO${i}`] ?? '');
    out[`LINE${i}`] = String(target[`LINE${i}`] ?? '');
  }
  const total = target.Total;
  if (typeof total === 'number' && Number.isFinite(total)) out.Total = String(Math.round(total));
  return out;
}
