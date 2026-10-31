// Workflow helpers for the builder: templates, "allowed when status is one of", checks. Pure.
import { parseAllowedWhen } from '@/lib/spec/expressions';
import type { ActionSpec, FormSpec } from '@/lib/spec/types';

export type Workflow = FormSpec['workflow'];
export type WorkflowTemplate = 'public-submit' | 'internal-only';
export const NEW_STATUS = 'Incomplete';
const CONFIRMATION = 'Thank you for filling out the form. Your response has been recorded.';

/** "Public submit, staff update" (default) or "Internal only" (staff create and update; no public action). */
export function workflowTemplate(kind: WorkflowTemplate): Workflow {
  const roles = [{ id: 0, name: 'Public', public: true }, { id: 1, name: 'Internal', internal: true }];
  const statuses = [{ id: 0, name: NEW_STATUS, color: 'gray' }, { id: 1, name: 'Submitted', color: 'teal' }];
  const update: ActionSpec = { id: 2, name: 'Update', button: 'Update', allowedWhen: `status != '${NEW_STATUS}' AND role == 'Internal'`, emails: [] };
  if (kind === 'internal-only') {
    return {
      roles, statuses,
      actions: [{ id: 1, name: 'Submit', button: 'Save', allowedWhen: `status == '${NEW_STATUS}' AND role == 'Internal'`, newStatus: 'Submitted', confirmation: 'Saved.', emails: [] }, update],
    };
  }
  return {
    roles, statuses,
    actions: [{ id: 1, name: 'Submit', button: 'Submit', allowedWhen: `status == '${NEW_STATUS}'`, newStatus: 'Submitted', confirmation: CONFIRMATION, emails: [] }, update],
  };
}

export interface AllowedWhen {
  /** null = any status. */
  statuses: string[] | null;
  /** null = any role. */
  role: string | null;
}

/** Builds allowedWhen from "status is one of" + optional role. */
export function allowedWhenFor(a: AllowedWhen): string {
  const parts: string[] = [];
  if (a.statuses && a.statuses.length === 1) parts.push(`status == '${a.statuses[0]}'`);
  else if (a.statuses && a.statuses.length > 1) parts.push(`status in (${a.statuses.map((s) => `'${s}'`).join(', ')})`);
  if (a.role) parts.push(`role == '${a.role}'`);
  return parts.length ? parts.join(' AND ') : 'always';
}

/** Reads allowedWhen back for the editor. status != 'X' becomes every other status. Null when not representable. */
export function readAllowedWhen(expr: string, allStatuses: string[]): AllowedWhen | null {
  if (expr.trim() === 'always') return { statuses: null, role: null };
  let statuses: string[] | null = null;
  let role: string | null = null;
  for (const raw of expr.split(/\s+AND\s+/)) {
    const s = raw.trim();
    let m = s.match(/^status\s*==\s*'([^']*)'$/);
    if (m) { statuses = [m[1]]; continue; }
    m = s.match(/^status\s*!=\s*'([^']*)'$/);
    if (m) { const not = m[1]; statuses = allStatuses.filter((x) => x !== not); continue; }
    m = s.match(/^status\s+in\s+\((.*)\)$/);
    if (m) { statuses = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]); continue; }
    m = s.match(/^role\s*==\s*'([^']*)'$/);
    if (m) { role = m[1]; continue; }
    return null;
  }
  return { statuses, role };
}

/** Problems that would break the workflow engine (lib/workflow/rules). */
export function workflowProblems(w: Workflow): string[] {
  const out: string[] = [];
  const statuses = w.statuses.map((s) => s.name);
  if (!statuses.includes(NEW_STATUS)) out.push(`The workflow needs the "${NEW_STATUS}" status (new entries start there).`);
  if (new Set(statuses).size !== statuses.length) out.push('Status names must be unique.');
  if (statuses.some((s) => !s.trim() || s.includes("'"))) out.push('Status names cannot be empty or contain quotes.');
  if (w.roles.filter((r) => r.public).length !== 1) out.push('The workflow needs exactly one public role.');
  if (w.roles.filter((r) => r.internal).length !== 1) out.push('The workflow needs exactly one internal role.');
  const roleNames = w.roles.map((r) => r.name);
  if (new Set(roleNames).size !== roleNames.length) out.push('Role names must be unique.');
  const names = w.actions.map((a) => a.name);
  if (new Set(names).size !== names.length) out.push('Action names must be unique.');
  if (!w.actions.length) out.push('Add at least one action.');
  for (const a of w.actions) {
    if (!/^[A-Za-z][A-Za-z0-9 _-]{0,40}$/.test(a.name)) out.push(`Action "${a.name}": use letters, numbers, spaces, - or _.`);
    if (!a.button.trim()) out.push(`Action "${a.name}" needs a button label.`);
    try {
      parseAllowedWhen(a.allowedWhen);
    } catch {
      out.push(`Action "${a.name}": "allowed when" is not valid.`);
    }
    if (a.newStatus && !statuses.includes(a.newStatus)) out.push(`Action "${a.name}" moves to an unknown status "${a.newStatus}".`);
    for (const e of a.emails) {
      if (e.linkForRole && !roleNames.includes(e.linkForRole)) out.push(`Action "${a.name}": an email links for an unknown role.`);
    }
  }
  const startable = w.actions.some((a) => {
    try {
      return w.roles.some((r) => parseAllowedWhen(a.allowedWhen)({ status: NEW_STATUS, role: r.name }));
    } catch {
      return false;
    }
  });
  if (w.actions.length && !startable) out.push(`No action can start an entry (none is allowed when status is "${NEW_STATUS}").`);
  return out;
}
