// Pure permission model. Roles and permissions exist from day one; only `admin` is used today.
// Add a permission here before using it anywhere, and cover it in tests/unit/can.test.ts.
// Roles mirror the app_role enum (0001, plus `factory` from 0010). `factory` is dispatch staff: stock only.

export const ROLES = ['admin', 'staff', 'reviewer', 'inspector', 'factory'] as const;
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
  'xero.read',
  'leads.read',
  'leads.manage',
  'import.run',
  'stock.read',
  'stock.dispatch',
  'stock.export',
  'stock.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  staff: ['admin.access', 'forms.read', 'entries.read', 'entries.write', 'entries.export', 'tasks.read', 'xero.read', 'leads.read', 'leads.manage',
    'stock.read', 'stock.dispatch', 'stock.export'],
  reviewer: ['admin.access', 'forms.read', 'entries.read', 'entries.review', 'entries.approve', 'tasks.read', 'xero.read', 'stock.read'],
  inspector: ['forms.read'],
  // Factory staff: stock register and dispatch only. Never entries, forms or Xero (RLS agrees: 0011).
  factory: ['admin.access', 'stock.read', 'stock.dispatch'],
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
