// Settings > Organisation form rules. Pure.
import { z } from 'zod';
import { parseFxInput } from './fx';

/** Display currencies offered (HANDOFF section 1: portal values in USD; Xero data stays ZAR with a badge). */
export const DISPLAY_CURRENCIES = [
  { code: 'USD', label: 'USD · US dollar' },
  { code: 'ZAR', label: 'ZAR · South African rand' },
] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number]['code'];

/** Rate sources. Only a manual rate exists; a daily feed is not built. */
export const FX_SOURCES = [{ value: 'manual', label: 'Manual rate' }] as const;

const OrgInput = z.object({
  name: z.string().trim().min(1).max(120),
  timezone: z.string().max(64).refine((v) => Intl.supportedValuesOf('timeZone').includes(v)),
  currency: z.enum(['USD', 'ZAR']),
  fxSource: z.literal('manual'),
});

export type OrgField = 'name' | 'timezone' | 'currency' | 'fxSource' | 'fxRate';
export type OrgFieldErrors = Partial<Record<OrgField, string>>;

export interface OrgValue { name: string; timezone: string; currency: DisplayCurrency; fxRate: string | null }

export type OrgParse = { ok: true; value: OrgValue } | { ok: false; errors: OrgFieldErrors };

const MESSAGES: Record<Exclude<OrgField, 'fxRate'>, string> = {
  name: 'Enter the organisation name (up to 120 characters).',
  timezone: 'Choose a timezone from the list.',
  currency: 'Choose USD or ZAR.',
  fxSource: 'Choose a rate source.',
};

/** Validates the Organisation form. Field errors are fixed texts (they never echo the input). */
export function parseOrgForm(raw: Record<string, unknown>): OrgParse {
  const parsed = OrgInput.safeParse(raw);
  const errors: OrgFieldErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const k = issue.path[0] as keyof typeof MESSAGES;
      if (k in MESSAGES && !errors[k]) errors[k] = MESSAGES[k];
    }
  }
  const fx = parseFxInput(raw.fxRate ?? null);
  if (!fx.ok) errors.fxRate = fx.error;
  if (!parsed.success || !fx.ok) return { ok: false, errors };
  return { ok: true, value: { name: parsed.data.name, timezone: parsed.data.timezone, currency: parsed.data.currency, fxRate: fx.value } };
}

/** "Africa/Johannesburg (SAST, UTC+2)" for the design's zone; other zones by name. */
export function timezoneLabel(zone: string): string {
  return zone === 'Africa/Johannesburg' ? 'Africa/Johannesburg (SAST, UTC+2)' : zone;
}

/** What changed, for the audit row: field names and non-personal values (currency, timezone, rate). */
export function orgChanges(before: { name: string; timezone: string; currency: string; fxRate: string | null }, after: OrgValue) {
  const changed: string[] = [];
  if (before.name !== after.name) changed.push('name');
  if (before.timezone !== after.timezone) changed.push('timezone');
  if (before.currency !== after.currency) changed.push('currency');
  const fxChanged = (before.fxRate ?? null) !== after.fxRate;
  return { changed, fxChanged };
}
