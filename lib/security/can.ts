// Pure permission model. Roles and permissions exist from day one; only `admin` is used today.
// Add a permission here before using it anywhere, and cover it in tests/unit/can.test.ts.

export const ROLES = ['admin', 'staff', 'reviewer', 'inspector'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'admin.access',
  'forms.read',
  'forms.manage',
  'entries.read',
  'entries.write',
  'entries.delete',
  'entries.export',
  'entries.review',
  'entries.approve',
  'tasks.read',
  'settings.manage',
  'users.manage',
  'audit.read',
  'integrations.manage',
  'xero.actions.configure',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  staff: ['admin.access', 'forms.read', 'entries.read', 'entries.write', 'entries.export', 'tasks.read'],
  reviewer: ['admin.access', 'forms.read', 'entries.read', 'entries.review', 'entries.approve', 'tasks.read'],
  inspector: ['forms.read'],
};

export interface Member {
  userId: string;
  orgId: string;
  role: Role;
  /** Optional branch scope; null means all branches. */
  branch: string | null;
}

export function can(member: Member | null | undefined, permission: Permission): boolean {
  if (!member) return false;
  return ROLE_PERMISSIONS[member.role]?.includes(permission) ?? false;
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(permission: Permission) {
    super(`Forbidden: missing permission ${permission}`);
    this.name = 'ForbiddenError';
  }
}

/** Throws ForbiddenError unless the member holds the permission. Returns the member for chaining. */
export function assertPerm(member: Member | null | undefined, permission: Permission): Member {
  if (!member || !can(member, permission)) throw new ForbiddenError(permission);
  return member;
}
