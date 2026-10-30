// Pure permission model (M7, docs/M7.md section 1).
//
// Each member has an access level per area (the menus): none | read | write. Presets (the roles) fill the levels;
// any area can then be changed, which makes the member "Custom". The resolved map is stored on the membership
// (memberships.access), so SQL (public.has_access, 0021) and can() read the same thing.
//
// Permissions keep their names; each resolves to (area, level) rules or is admin-only. Add a permission here before
// using it anywhere, and cover it in tests/unit/can.test.ts. Roles mirror the app_role enum (0001, plus `factory`
// from 0010).

export const ROLES = ['admin', 'staff', 'reviewer', 'inspector', 'factory'] as const;
export type Role = (typeof ROLES)[number];

export const AREAS = [
  'home', 'tasks', 'forms', 'deals', 'quotes', 'invoices', 'leads', 'stock', 'integrations', 'settings', 'users', 'activity',
] as const;
export type Area = (typeof AREAS)[number];

export const LEVELS = ['none', 'read', 'write'] as const;
export type Level = (typeof LEVELS)[number];
export type AccessMap = Record<Area, Level>;

export const MEMBER_STATUSES = ['invited', 'active', 'disabled'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const AREA_LABELS: Record<Area, string> = {
  home: 'Home', tasks: 'Tasks', forms: 'Forms', deals: 'Deals', quotes: 'Quotes', invoices: 'Invoices', leads: 'Leads',
  stock: 'Stock', integrations: 'Integrations', settings: 'Settings', users: 'Users', activity: 'Activity log',
};
export const LEVEL_LABELS: Record<Level, string> = { none: 'None', read: 'Read', write: 'Write' };
export const ROLE_LABELS: Record<Role, string> = { admin: 'Admin', staff: 'Staff', reviewer: 'Reviewer', inspector: 'Inspector', factory: 'Factory' };

const every = (level: Level): AccessMap => Object.fromEntries(AREAS.map((a) => [a, level])) as AccessMap;

/** Preset table (docs/M7.md section 1). Admin is write everywhere and also holds the admin-only permissions. */
export const PRESET_ACCESS: Record<Role, AccessMap> = {
  admin: every('write'),
  staff: {
    home: 'read', tasks: 'read', forms: 'write', deals: 'read', quotes: 'read', invoices: 'read', leads: 'write',
    stock: 'write', integrations: 'none', settings: 'none', users: 'none', activity: 'none',
  },
  reviewer: {
    home: 'read', tasks: 'read', forms: 'read', deals: 'read', quotes: 'read', invoices: 'read', leads: 'none',
    stock: 'read', integrations: 'none', settings: 'none', users: 'none', activity: 'none',
  },
  factory: { ...every('none'), home: 'read', stock: 'write' },
  // Role links only: no admin area at all.
  inspector: every('none'),
};

/**
 * Areas a role can never use, whatever its stored map says. Factory accounts never read entries, the Xero mirror
 * or leads: 0011's restrictive `*_not_factory` RLS policies enforce the same in SQL. To give someone more, choose
 * another preset.
 */
export const ROLE_CEILING: Partial<Record<Role, readonly Area[]>> = {
  factory: ['tasks', 'forms', 'deals', 'quotes', 'invoices', 'leads'],
};

const isLevel = (v: unknown): v is Level => typeof v === 'string' && (LEVELS as readonly string[]).includes(v);
export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);
export const isArea = (v: unknown): v is Area => typeof v === 'string' && (AREAS as readonly string[]).includes(v);

/**
 * The effective map for a role: admin is all write; unknown or missing areas are none; areas above the role's
 * ceiling are none. Stored maps go through this before saving, so the stored map is the effective one.
 */
export function clampAccess(role: Role, access: Readonly<Record<string, unknown>> | null | undefined): AccessMap {
  if (role === 'admin') return every('write');
  const ceiling = ROLE_CEILING[role] ?? [];
  return Object.fromEntries(
    AREAS.map((a) => {
      const v = access?.[a];
      return [a, ceiling.includes(a) ? 'none' : isLevel(v) ? v : 'none'];
    }),
  ) as AccessMap;
}

export const sameAccess = (a: AccessMap, b: AccessMap) => AREAS.every((x) => a[x] === b[x]);

/** The preset name when the map is exactly the role's preset, else 'custom'. */
export function presetOf(role: Role, access: AccessMap): Role | 'custom' {
  return sameAccess(clampAccess(role, access), clampAccess(role, PRESET_ACCESS[role])) ? role : 'custom';
}

export function atLeast(have: Level, need: Exclude<Level, 'none'>): boolean {
  return need === 'read' ? have === 'read' || have === 'write' : have === 'write';
}

export const PERMISSIONS = [
  'admin.access',
  'home.read',
  'forms.read',
  'forms.manage',
  'entries.read',
  'entries.write',
  'entries.delete',
  'entries.export',
  'entries.review',
  'entries.approve',
  'tasks.read',
  'settings.read',
  'settings.manage',
  'users.read',
  'users.manage',
  'audit.read',
  'integrations.read',
  'integrations.manage',
  'xero.actions.configure',
  /** @deprecated Split into deals.read / quotes.read / invoices.read (M7). Kept so older call sites still compile. */
  'xero.read',
  'deals.read',
  'quotes.read',
  'invoices.read',
  'leads.read',
  'leads.manage',
  'import.run',
  'stock.read',
  'stock.dispatch',
  'stock.export',
  'stock.manage',
  'stock.invoices',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

type Need = readonly [Area, Exclude<Level, 'none'>];
/** all: every need holds; any: at least one holds; roles: the member's role must be one of these; admin: admin-only. */
export interface Rule { all?: readonly Need[]; any?: readonly Need[]; roles?: readonly Role[]; admin?: true }

const r = (area: Area): Rule => ({ all: [[area, 'read']] });
const w = (area: Area): Rule => ({ all: [[area, 'write']] });

/** Permission -> requirement (docs/M7.md section 1). Exported for the docs table and tests. */
export const RULES: Record<Permission, Rule> = {
  'admin.access': { any: AREAS.map((a) => [a, 'read'] as const) },
  'home.read': r('home'),
  'forms.read': r('forms'),
  'forms.manage': w('settings'),
  'entries.read': r('forms'),
  'entries.write': w('forms'),
  'entries.delete': { admin: true },
  'entries.export': r('forms'),
  // Workflow approval stays a role, not a menu: the reviewer preset has forms read, so read (not write) is required.
  'entries.review': { all: [['forms', 'read']], roles: ['admin', 'reviewer'] },
  'entries.approve': { all: [['forms', 'read']], roles: ['admin', 'reviewer'] },
  // Every task opens an entry page (entries.read), so Tasks also needs Forms read.
  'tasks.read': { all: [['tasks', 'read'], ['forms', 'read']] },
  'settings.read': r('settings'),
  'settings.manage': w('settings'),
  'users.read': r('users'),
  'users.manage': w('users'),
  'audit.read': r('activity'),
  'integrations.read': r('integrations'),
  'integrations.manage': w('integrations'),
  'xero.actions.configure': { admin: true },
  'xero.read': { all: [['quotes', 'read'], ['invoices', 'read']] },
  'deals.read': r('deals'),
  'quotes.read': r('quotes'),
  'invoices.read': r('invoices'),
  'leads.read': r('leads'),
  'leads.manage': w('leads'),
  'import.run': { admin: true },
  'stock.read': r('stock'),
  'stock.dispatch': w('stock'),
  'stock.export': r('stock'),
  'stock.manage': { admin: true },
  // Invoice review (stock Invoices tab, exceptions queue) shows Xero references: stock and invoices (0021 RLS agrees).
  'stock.invoices': { all: [['stock', 'read'], ['invoices', 'read']] },
};

export interface Member {
  userId: string;
  orgId: string;
  role: Role;
  /** Optional branch scope; null means all branches. */
  branch: string | null;
  /**
   * Resolved area levels (memberships.access). getMember() always fills it; when absent (a Member built from a
   * role, e.g. in tests or scripts) the role's preset applies.
   */
  access?: AccessMap;
  /** getMember() always fills it; when absent, a Member built from a role counts as active. */
  status?: MemberStatus;
  /** Added with a temporary password and not changed yet: the app only lets them change it (requirePerm redirects). */
  mustChangePassword?: boolean;
}

/** The member's effective levels (clamped to the role ceiling; admin is all write). */
export function accessOf(member: Pick<Member, 'role' | 'access'>): AccessMap {
  return clampAccess(member.role, member.access ?? PRESET_ACCESS[member.role]);
}

/** Read level or better for the area (and an active membership). */
/** Active, on their own password, with a known role. */
const usable = (member: Member | null | undefined): member is Member =>
  !!member && (member.status ?? 'active') === 'active' && !member.mustChangePassword && isRole(member.role);

export function canArea(member: Member | null | undefined, area: Area, level: Exclude<Level, 'none'> = 'read'): boolean {
  if (!usable(member)) return false;
  return atLeast(accessOf(member)[area], level);
}

export function can(member: Member | null | undefined, permission: Permission): boolean {
  if (!usable(member)) return false;
  const rule = RULES[permission];
  if (!rule) return false;
  if (member.role === 'admin') return true;
  if (rule.admin) return false;
  if (rule.roles && !rule.roles.includes(member.role)) return false;
  const access = accessOf(member);
  const ok = ([area, level]: Need) => atLeast(access[area], level);
  if (rule.all && !rule.all.every(ok)) return false;
  if (rule.any && !rule.any.some(ok)) return false;
  return true;
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
