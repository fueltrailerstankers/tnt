// Workflow rules from spec.workflow. Pure.
import { parseAllowedWhen } from '@/lib/spec/expressions';
import type { ActionSpec, FormSpec, RoleSpec } from '@/lib/spec/types';
import type { Permission } from '@/lib/security/can';

export const NEW_ENTRY_STATUS = 'Incomplete';

/** Generic actions every form has. They never make an entry a task. */
const GENERIC_ACTIONS = new Set(['Update', 'Action']);

/** Statuses that wait on staff with no spec action to move them (set manually on the entry page). */
const MANUAL_TASK_STATUSES: Record<string, string[]> = { 'store-room': ['APPROVAL'] };

export function publicRole(spec: FormSpec): RoleSpec {
  const r = spec.workflow.roles.find((x) => x.public);
  if (!r) throw new Error(`${spec.slug}: no public role`);
  return r;
}

export function internalRole(spec: FormSpec): RoleSpec {
  const r = spec.workflow.roles.find((x) => x.internal);
  if (!r) throw new Error(`${spec.slug}: no internal role`);
  return r;
}

export function roleByName(spec: FormSpec, name: string): RoleSpec | undefined {
  return spec.workflow.roles.find((r) => r.name === name);
}

export function isActionAllowed(action: ActionSpec, status: string, role: string): boolean {
  return parseAllowedWhen(action.allowedWhen)({ status, role });
}

export function allowedActions(spec: FormSpec, status: string, role: string): ActionSpec[] {
  return spec.workflow.actions.filter((a) => isActionAllowed(a, status, role));
}

export function findAction(spec: FormSpec, name: string): ActionSpec | undefined {
  return spec.workflow.actions.find((a) => a.name === name);
}

/** Whether a staff member (internal role) has something to do on an entry in this status. */
export function isTask(spec: FormSpec, status: string): boolean {
  if (MANUAL_TASK_STATUSES[spec.slug]?.includes(status)) return true;
  const role = internalRole(spec).name;
  return spec.workflow.actions.some((a) => !GENERIC_ACTIONS.has(a.name) && isActionAllowed(a, status, role));
}

export function taskStatuses(spec: FormSpec): string[] {
  return spec.workflow.statuses.map((s) => s.name).filter((s) => s !== NEW_ENTRY_STATUS && isTask(spec, s));
}

/**
 * Permission a staff member needs to run an action, on top of the spec's allowedWhen.
 * Review/approval steps need the reviewer permissions; everything else is an entry write.
 */
export function actionPermission(action: ActionSpec): Permission {
  if (/^Approve/.test(action.name)) return 'entries.approve';
  if (/Review/.test(action.name)) return 'entries.review';
  return 'entries.write';
}

/** Statuses staff may set by hand (current, non-archived spec statuses other than Incomplete). */
export function manualStatuses(spec: FormSpec): string[] {
  return spec.workflow.statuses.filter((s) => !s.archived && s.name !== NEW_ENTRY_STATUS).map((s) => s.name);
}

export function statusColor(spec: FormSpec, status: string): string {
  return spec.workflow.statuses.find((s) => s.name === status)?.color ?? 'gray';
}
