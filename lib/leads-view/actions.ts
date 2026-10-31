// Shapes shared by the leads server actions and their client callers. Pure; no personal data in any result.

/** Sources staff can pick in Add lead (both exist in lead_sources; neither sends a notification). */
export const UI_SOURCES = ['manual', 'test'] as const;
export type UiSource = (typeof UI_SOURCES)[number];

export type ActionError = 'invalid' | 'notfound' | 'save' | 'merged' | 'changed' | 'forbidden';
export type ActionResult = { ok: true } | { ok: false; error: ActionError };
export type AddLeadResult = { ok: true; id: string; duplicate: boolean } | { ok: false; error: ActionError; fields: string[] };

const MESSAGES: Record<ActionError, string> = {
  invalid: 'Check the value and try again.',
  notfound: 'This lead no longer exists or is not in your organisation.',
  save: 'That change could not be saved. Try again.',
  merged: 'This lead was merged into another lead and can no longer be changed.',
  changed: 'The duplicate flag on this lead changed since the page loaded. Reload and try again.',
  forbidden: 'You do not have permission to change leads.',
};

/** Codes the 0023 lead RPCs raise (message = code, hint = 'leads'). */
export const LEAD_RPC_CODES = ['FORBIDDEN', 'INVALID_INPUT', 'LEAD_NOT_FOUND', 'LEAD_MERGED', 'DUPLICATE_CHANGED'] as const;
export type LeadRpcCode = (typeof LEAD_RPC_CODES)[number];

const RPC_ERROR: Record<LeadRpcCode, ActionError> = {
  FORBIDDEN: 'forbidden', INVALID_INPUT: 'invalid', LEAD_NOT_FOUND: 'notfound', LEAD_MERGED: 'merged', DUPLICATE_CHANGED: 'changed',
};

/**
 * Maps an error from lead_merge / lead_not_duplicate / lead_set_branch (PostgREST { message, hint } or node-postgres)
 * to the action error the page shows. Anything that is not one of our codes is a plain `save` failure.
 */
export function leadRpcError(err: unknown): ActionError {
  if (!err || typeof err !== 'object') return 'save';
  const { message, hint } = err as { message?: unknown; hint?: unknown };
  if (hint !== 'leads' || typeof message !== 'string') return 'save';
  return (LEAD_RPC_CODES as readonly string[]).includes(message) ? RPC_ERROR[message as LeadRpcCode] : 'save';
}

export function actionMessage(e: ActionError): string {
  return MESSAGES[e] ?? MESSAGES.save;
}

/** Field names a lead form knows; anything else in an error list is reported as the whole form. */
export const LEAD_FORM_FIELDS = ['name', 'email', 'phone', 'product', 'branch', 'message', 'source'] as const;

/** Error text for the Add lead form. The contact rule (email or 9-digit phone) is reported on `email`. */
export function fieldErrors(fields: readonly string[]): Partial<Record<(typeof LEAD_FORM_FIELDS)[number] | 'form', string>> {
  const out: Partial<Record<(typeof LEAD_FORM_FIELDS)[number] | 'form', string>> = {};
  for (const f of fields) {
    if (f === 'email') out.email = 'Give a valid email, or a phone number with at least 9 digits.';
    else if (f === 'phone') out.phone = 'Check the phone number.';
    else if (f === 'branch') out.branch = 'Use letters, spaces, dots, apostrophes or hyphens.';
    else if (f === 'source') out.source = 'Choose Manual or Test.';
    else if ((LEAD_FORM_FIELDS as readonly string[]).includes(f)) out[f as 'name'] = 'Check this field (it may be too long).';
    else out.form = 'The lead could not be saved. Try again.';
  }
  return out;
}
