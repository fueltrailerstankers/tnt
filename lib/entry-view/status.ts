// Entry detail right rail: the status path, the Store Room flow and the role-based actions. Pure.
import type { Member } from '@/lib/security/can';
import { can } from '@/lib/security/can';
import type { FormSpec } from '@/lib/spec/types';
import { toneFor, type Tone } from '@/lib/ui/status';
import { actionPermission, allowedActions, internalRole, NEW_ENTRY_STATUS, statusColor } from '@/lib/workflow/rules';

export type StepState = 'done' | 'current' | 'todo';

export interface StatusStep {
  label: string;
  state: StepState;
  /** 1-based position, shown in the dot when the step is not done. */
  n: number;
  tone: Tone;
}

/**
 * Horizontal path of the spec statuses for the status card. Archived statuses are left out; Incomplete only shows
 * while the entry is still Incomplete. The last step reads done once the entry reaches it (design: Approved = ✓).
 * A status that is not on the path (e.g. an archived one) leaves every step "todo"; the chip still shows it.
 */
export function statusPath(spec: FormSpec, status: string): StatusStep[] {
  const names = spec.workflow.statuses
    .filter((s) => !s.archived && (s.name !== NEW_ENTRY_STATUS || status === NEW_ENTRY_STATUS))
    .map((s) => s.name);
  const at = names.indexOf(status);
  const last = names.length - 1;
  return names.map((name, i) => ({
    label: name,
    n: i + 1,
    tone: toneFor(name, statusColor(spec, name)),
    state: at < 0 ? 'todo' : i < at || (i === at && at === last) ? 'done' : i === at ? 'current' : 'todo',
  }));
}

/** Forms whose final status is set by hand on the entry page (handoff rule 5). */
export const MANUAL_FINAL: Record<string, { status: string; button: string; note: string; from: string }> = {
  'store-room': {
    status: 'APPROVED EMAILED',
    from: 'APPROVAL',
    button: 'Mark APPROVED EMAILED',
    note: 'Set manually after the order email has gone to suppliers.',
  },
};

export interface FlowStep {
  label: string;
  status: string;
  state: StepState;
  n: number;
  tone: Tone;
}

/**
 * Vertical flow for the Store Room aside: every status after Incomplete, archived ones labelled "(archived)"
 * (Submitted (archived) → APPROVAL → APPROVED EMAILED). Steps before the current one are done; the final status
 * reads done once reached.
 */
export function statusFlow(spec: FormSpec, status: string): FlowStep[] {
  const list = spec.workflow.statuses.filter((s) => s.name !== NEW_ENTRY_STATUS);
  const at = list.findIndex((s) => s.name === status);
  const last = list.length - 1;
  return list.map((s, i) => ({
    label: s.archived ? `${s.name} (archived)` : s.name,
    status: s.name,
    n: i + 1,
    tone: s.archived ? 'gray' : toneFor(s.name, s.color),
    state: at < 0 ? 'todo' : i < at || (i === at && at === last) ? 'done' : i === at ? 'current' : 'todo',
  }));
}

/** Actions that only save the form; they stay with the form's own buttons, never in the rail. */
const SAVE_ONLY = new Set(['Update', 'Action']);
/** Same rule as the form's buttons: change/reject/cancel/decline are secondary (outlined). */
const SECONDARY = /change|reject|cancel|decline/i;

/** "MarkReviewed" -> "Mark reviewed", "RequestReviewChanges" -> "Request review changes". Labels with spaces stay. */
export function humanizeAction(label: string): string {
  const t = label.trim();
  if (!t || /\s/.test(t)) return t;
  const words = t.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(' ');
  return words.map((w, i) => (i === 0 ? w : /^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');
}

export interface RailAction {
  /** Spec action name, posted as __action (the same as the form's own button). */
  name: string;
  /** Readable label for the rail ("Mark reviewed"); the form's own button keeps the spec text ("MarkReviewed"). */
  label: string;
  tone: 'primary' | 'secondary';
}

/** Every action the member may run now (allowedWhen for the internal role + the action's permission). */
export function availableActions(spec: FormSpec, status: string, member: Member | null) {
  return allowedActions(spec, status, internalRole(spec).name).filter((a) => can(member, actionPermission(a)));
}

/** Workflow actions for the status card: everything available except the plain save actions. */
export function railActions(spec: FormSpec, status: string, member: Member | null): RailAction[] {
  return availableActions(spec, status, member)
    .filter((a) => !SAVE_ONLY.has(a.name))
    .map((a) => ({ name: a.name, label: humanizeAction(a.button || a.name), tone: SECONDARY.test(a.name) ? 'secondary' : 'primary' }));
}

/** The line under the actions: what this member can do here, in words. */
export function roleNote(opts: { anyAction: boolean; railCount: number }): string {
  if (!opts.anyAction) return 'No action is available for this entry at its current status.';
  if (opts.railCount === 0) return 'Save changes with the buttons at the end of the form.';
  return 'Every action is recorded in the timeline.';
}
