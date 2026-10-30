// Typed confirmations (TypedConfirmModal). Pure, so the client and the server action apply the same rule: the typed
// text must equal the phrase exactly. Case, inner spacing and surrounding whitespace all count, so "LIVE x " does
// not match "LIVE x". The phrase itself must contain something other than whitespace.

/** True only when `typed` is exactly `phrase` and the phrase is not blank. */
export function typedMatches(typed: string | null | undefined, phrase: string): boolean {
  if (typeof typed !== 'string' || typeof phrase !== 'string') return false;
  if (phrase.trim().length === 0) return false;
  return typed === phrase;
}

/** The design's phrase for switching a Xero write action to Live: "LIVE createInvoiceFromQuote". */
export function livePhrase(actionName: string): string {
  return `LIVE ${actionName}`;
}
