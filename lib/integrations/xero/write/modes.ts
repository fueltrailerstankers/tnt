// Action modes. Pure.
//
//   off      nothing happens; a 'skipped' run is logged so staff can see the trigger fired
//   dry_run  the planned Xero requests are recorded, nothing is sent to Xero
//   live     the requests are sent, each claimed once in action_claims
//
// The mode is app_settings "xero.action.<name>" (a JSON string). Missing or unknown means off.
// Live additionally needs a Xero connection that was granted the write scopes. M2 connects read-only, so no
// action can be live until an admin reconnects with XERO_SCOPES including the write scopes.
// Our own entries and emails are not Xero writes, but dry run does not apply them either: it only records the
// entries/emails it would make, and live applies them. So an action without Xero writes does nothing in dry run.
import { livePhrase, typedMatches } from '@/lib/ui/confirm';
import type { ActionName } from './types';

export const MODES = ['off', 'dry_run', 'live'] as const;
export type ActionMode = (typeof MODES)[number];

export const WRITE_SCOPES = ['accounting.transactions', 'accounting.contacts', 'accounting.attachments'] as const;

export const settingKey = (action: ActionName) => `xero.action.${action}`;

/** Actions that send writes to Xero. The others read Xero and write only our own entries and emails. */
export const WRITES_TO_XERO: Record<ActionName, boolean> = {
  'deal.import_quote': false,
  'rfi.create_invoice': true,
  'delivery.update_invoice': true,
  'release.on_paid': false,
  'invoice.merge_attachments': true,
};

/** Settings page note for actions that write only our own entries and emails. */
export const NO_XERO_WRITES_NOTE = 'no Xero writes; dry run only records the entries/emails it would make, live applies them';

/** True when the action changes nothing in this mode: it has no Xero writes and dry run applies no effects. */
export function dryRunDoesNothing(action: ActionName, mode: ActionMode): boolean {
  return mode === 'dry_run' && !WRITES_TO_XERO[action];
}

/** Actions whose live mode is not built yet (they only ever plan). */
export const PLAN_ONLY: Partial<Record<ActionName, string>> = {
  'invoice.merge_attachments': 'Merging needs pdf-lib, which is not installed yet. This action only plans.',
};

export function parseMode(value: unknown): ActionMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value) ? (value as ActionMode) : 'off';
}

export function hasWriteScopes(scopes: readonly string[] | null | undefined): boolean {
  const s = new Set(scopes ?? []);
  return WRITE_SCOPES.every((w) => s.has(w));
}

export interface ResolvedMode {
  /** What actually runs. */
  mode: ActionMode;
  /** What the setting asks for. */
  requested: ActionMode;
  /** Why the effective mode is lower than requested. */
  downgraded?: string;
}

/** Effective mode: the setting, lowered to dry_run when live is not possible. */
export function resolveMode(action: ActionName, setting: unknown, connection: { status: string; scopes: readonly string[] } | null): ResolvedMode {
  const requested = parseMode(setting);
  if (requested !== 'live') return { mode: requested, requested };
  if (PLAN_ONLY[action]) return { mode: 'dry_run', requested, downgraded: 'plan only' };
  if (!WRITES_TO_XERO[action]) return { mode: 'live', requested };
  if (!connection || connection.status !== 'connected') return { mode: 'dry_run', requested, downgraded: 'Xero not connected' };
  if (!hasWriteScopes(connection.scopes)) return { mode: 'dry_run', requested, downgraded: 'connection lacks write scopes' };
  return { mode: 'live', requested };
}

export interface SwitchRequest {
  action: ActionName;
  to: ActionMode;
  /** The user holds xero.actions.configure. */
  mayConfigure: boolean;
  connection: { status: string; scopes: readonly string[] } | null;
  /** What the user typed to confirm a switch to live: must be exactly liveConfirmPhrase(action). */
  typed: string | null | undefined;
}

/** The phrase that confirms a switch to live: "LIVE rfi.create_invoice" (HANDOFF section 5 rule 1). */
export function liveConfirmPhrase(action: ActionName): string {
  return livePhrase(action);
}

/** Validates a mode change. Returns an error message, or null when allowed. */
export function checkSwitch(r: SwitchRequest): string | null {
  if (!r.mayConfigure) return 'You do not have permission to change Xero actions.';
  if (!(MODES as readonly string[]).includes(r.to)) return 'Unknown mode.';
  if (r.to !== 'live') return null;
  if (PLAN_ONLY[r.action]) return PLAN_ONLY[r.action]!;
  if (WRITES_TO_XERO[r.action]) {
    if (!r.connection || r.connection.status !== 'connected') return 'Xero is not connected.';
    if (!hasWriteScopes(r.connection.scopes)) return `Reconnect Xero with the write scopes first (${WRITE_SCOPES.join(', ')}).`;
  }
  // Exact match: no trimming, no case folding. "LIVE x " or "live x" do not confirm.
  const phrase = liveConfirmPhrase(r.action);
  if (!typedMatches(r.typed, phrase)) return `Type ${phrase} to confirm.`;
  return null;
}
