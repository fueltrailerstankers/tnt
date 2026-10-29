// VIN normalisation and extraction from invoice references. Pure.
// normalizeVin matches the database's generated column stock_units.vin_norm = upper(regexp_replace(vin, '\s', '', 'g')),
// and extractVin follows the same order as stock_apply_invoice (0011): exact match first, then containment.

export const VIN_MIN_LENGTH = 5;
export const VIN_MAX_LENGTH = 40;

/** Upper case with all whitespace removed (" abc 123\t" -> "ABC123"). Null when nothing is left. */
export function normalizeVin(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s/g, '').toUpperCase();
  return s || null;
}

/** Whether a value normalises to an acceptable VIN length (the database enforces the same bounds). */
export function isValidVin(v: string | null | undefined): boolean {
  const n = normalizeVin(v);
  return !!n && n.length >= VIN_MIN_LENGTH && n.length <= VIN_MAX_LENGTH;
}

export type VinMatch =
  | { kind: 'exact'; vin: string }
  | { kind: 'contained'; vin: string }
  | { kind: 'ambiguous'; vins: string[] }
  | { kind: 'none' }
  | { kind: 'missing' };

/**
 * Finds the unit VIN an invoice reference points at.
 * 1. The whole normalised reference equals a known VIN -> exact.
 * 2. Otherwise exactly one known VIN is contained in the normalised reference -> contained.
 *    More than one -> ambiguous. None -> none. An empty reference -> missing.
 * knownVins may be raw or normalised; they are normalised here.
 */
export function extractVin(reference: string | null | undefined, knownVins: Iterable<string>): VinMatch {
  const ref = normalizeVin(reference);
  if (!ref) return { kind: 'missing' };
  const known = new Set<string>();
  for (const v of knownVins) {
    const n = normalizeVin(v);
    if (n) known.add(n);
  }
  if (known.has(ref)) return { kind: 'exact', vin: ref };
  const hits = [...known].filter((v) => ref.includes(v)).sort();
  if (hits.length === 1) return { kind: 'contained', vin: hits[0] };
  if (hits.length > 1) return { kind: 'ambiguous', vins: hits };
  return { kind: 'none' };
}

/** The matched VIN, or null for none / missing / ambiguous. */
export function matchedVin(m: VinMatch): string | null {
  return m.kind === 'exact' || m.kind === 'contained' ? m.vin : null;
}
