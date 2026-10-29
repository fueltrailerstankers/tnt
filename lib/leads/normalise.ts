// Lead normalisation. Pure. Same rules as the Make "Product Inquiry Form Leads" flow:
// email lower-cased and trimmed; phone reduced to digits and its last 9 digits (drops +27 / leading 0).

export function normEmail(email: string | null | undefined): string | null {
  const s = (email ?? '').trim().toLowerCase();
  return s || null;
}

/** Digits only, last 9. Fewer than 9 digits is not a usable phone number: null (avoids false duplicates). */
export function normPhone(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : null;
}
