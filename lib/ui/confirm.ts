// Typed confirmations (TypedConfirmModal). Pure, so the client and the server action apply the same rule:
// surrounding whitespace is ignored, everything else must match exactly (case-sensitive).

export function normaliseTyped(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/** True only for an exact match of a non-empty phrase. */
export function typedMatches(typed: string | null | undefined, phrase: string): boolean {
  const p = phrase.trim();
  return p.length > 0 && normaliseTyped(typed) === p;
}

/** The design's phrase for switching a Xero write action to Live: "LIVE createInvoiceFromQuote". */
export function livePhrase(actionName: string): string {
  return `LIVE ${actionName}`;
}
