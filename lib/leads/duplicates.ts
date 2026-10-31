// Duplicate detection. Pure. A lead is a duplicate when another lead in the same org has the same
// normalised email or phone; it links to the earliest such lead (following that lead's own link, or the lead it was
// merged into). A lead staff marked "Not a duplicate" of an original (not_duplicate_of, 0023) is never flagged
// against that original again.

export interface DupCandidate {
  id: string;
  email_norm: string | null;
  phone_norm: string | null;
  created_at: string;
  duplicate_of: string | null;
  /** Set when the lead was merged into another (0023); its original is then that lead. */
  merged_into?: string | null;
}

export function findDuplicateOf(
  lead: { id?: string; created_at?: string; email_norm: string | null; phone_norm: string | null; not_duplicate_of?: string | null },
  candidates: readonly DupCandidate[],
): string | null {
  // Only earlier leads can be the original (a new lead has no created_at yet: every candidate is earlier).
  const same = candidates.filter((c) => c.id !== lead.id && (!lead.created_at || c.created_at < lead.created_at) && (
    (lead.email_norm && c.email_norm === lead.email_norm) || (lead.phone_norm && c.phone_norm === lead.phone_norm)));
  if (!same.length) return null;
  const earliest = [...same].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))[0];
  const link = earliest.merged_into ?? earliest.duplicate_of;
  const original = link && link !== lead.id ? link : earliest.id;
  return lead.not_duplicate_of && original === lead.not_duplicate_of ? null : original;
}
