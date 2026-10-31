// Thank-you page wording per form (design ThankYou / RequestInvoice success). Pure.
// The confirmation text always comes from the spec; this only adds the heading and a reference prefix.

const PREFIX: Record<string, string> = {
  'request-for-invoice': 'RFI',
  'delivery-note': 'DN',
  deal: 'DEAL',
  'job-card': 'JC',
  'release-form': 'REL',
  'store-room': 'SR',
  'trailer-inspection-checklist': 'INS',
};

const HEADING: Record<string, string> = {
  'request-for-invoice': 'Thank you, we have your request',
  'delivery-note': 'Delivery signed. Safe travels.',
};

/** "RFI-388" for a positive whole entry number from the URL; null otherwise (never trusts other input). */
export function receiptReference(slug: string, n: string | undefined): string | null {
  if (!n || !/^\d{1,9}$/.test(n)) return null;
  const num = Number(n);
  if (num < 1) return null;
  return `${PREFIX[slug] ?? 'REF'}-${num}`;
}

export function receiptHeading(slug: string, formName: string | undefined): string {
  return HEADING[slug] ?? formName ?? 'Thank you';
}
