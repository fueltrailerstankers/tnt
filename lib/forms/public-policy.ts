// What the public role (public link /f and role links /e) may see and do. Pure; used by the public pages and
// their server actions so the browser never receives internal-only fields, files, signatures or lookups.
import { inputFields, type FormSpec, type InputField } from '@/lib/spec/types';
import { lockedFor, publicSpec } from '@/lib/spec/values';

/**
 * Lookups the public role may run, as (form, lookup field, source form, display field). Anything else is
 * staff-only. Today: the Delivery Note "Quote no" finds a Request For Invoice by its Quote no.
 */
export const PUBLIC_LOOKUPS: ReadonlyArray<{ form: string; field: string; source: string; display: string }> = [
  { form: 'delivery-note', field: 'QuoteNo', source: 'request-for-invoice', display: 'QuoteNo' },
];

/** Names of the fields the public role sees (internalOnly removed). */
export function publicFieldNames(spec: FormSpec): Set<string> {
  return new Set(inputFields(publicSpec(spec)).map((f) => f.name));
}

/** The form's lookup field when the public role may use it (allow-listed, not internalOnly); else null. */
export function publicLookupOf(spec: FormSpec): Extract<InputField, { type: 'lookup' }> | null {
  const f = inputFields(publicSpec(spec)).find((x): x is Extract<InputField, { type: 'lookup' }> => x.type === 'lookup');
  if (!f) return null;
  const ok = PUBLIC_LOOKUPS.some((l) => l.form === spec.slug && l.field === f.name && l.source === f.lookup.sourceForm && l.display === f.lookup.displayField);
  return ok ? f : null;
}

/** Keeps only the entries of a per-field record (files, signatures) that belong to fields the public sees. */
export function pickPublic<T>(spec: FormSpec, byField: Record<string, T>): Record<string, T> {
  const names = publicFieldNames(spec);
  return Object.fromEntries(Object.entries(byField).filter(([k]) => names.has(k)));
}

/** Upload tickets for the public role: only visible, unlocked file fields (readOnly/internalOnly refused). */
export function publicUploadAllowed(spec: FormSpec, field: string): boolean {
  return publicFieldNames(spec).has(field) && !lockedFor(spec, 'public').has(field);
}
