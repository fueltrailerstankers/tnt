// Field names and form slugs for the builder. Pure. A field name is the entries.data key: generated from the
// label once, never renamed after the form has data (guards.ts).
import { isReservedFormSlug } from '@/lib/spec/types';

export const FIELD_NAME_RE = /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** The kit forms' slugs: kept by the kit forms, never given to a new builder form. */
export const KIT_SLUGS = new Set(['deal', 'request-for-invoice', 'delivery-note', 'release-form', 'job-card', 'store-room', 'trailer-inspection-checklist']);
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function unique(base: string, taken: Set<string>, sep: string): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}${sep}${i}`)) return `${base}${sep}${i}`;
}

/** "Customer phone no." -> "CustomerPhoneNo" (unique among `taken`; "Field" when the label has no letters). */
export function fieldNameFromLabel(label: string, taken: Iterable<string>): string {
  const words = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, ' ').replace(/_/g, ' ').trim().split(/\s+/).filter(Boolean);
  let base = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('').replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
  if (!base || /^(Constructor|Prototype)$/.test(base)) base = base ? `${base}Field` : 'Field';
  if (!/^[A-Za-z]/.test(base)) base = `F${base}`.slice(0, 40);
  return unique(base, new Set(taken), '');
}

/** "Site Visit Report" -> "site-visit-report"; never a reserved slug; unique among `taken`. */
export function slugFromName(name: string, taken: Iterable<string>): string {
  let base = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  if (!base) base = 'form';
  const set = new Set(taken);
  if (isReservedFormSlug(base) || KIT_SLUGS.has(base)) base = `${base}-form`;
  return unique(base, set, '-');
}

/** Why a slug cannot be used, or null. */
export function slugProblem(slug: string, taken: Iterable<string>): string | null {
  if (!SLUG_RE.test(slug)) return 'Use lower-case letters, numbers and dashes (up to 64).';
  if (isReservedFormSlug(slug)) return 'This slug is reserved for a page of the app.';
  if (KIT_SLUGS.has(slug)) return 'This slug belongs to a standard form.';
  if (new Set(taken).has(slug)) return 'Another form already uses this slug.';
  return null;
}
