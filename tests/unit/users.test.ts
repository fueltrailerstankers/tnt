import { describe, expect, it } from 'vitest';
import { areaOf, areaOrFilter, describe as describeRow, filterQuery, hrefFor, parseFilters, toCsv, type AuditRow } from '@/lib/activity/describe';
import { AREAS, PRESET_ACCESS, type AccessMap } from '@/lib/security/can';
import {
  AddInput, acceptMode, accessChanges, accessFromForm, banDecision, changeError, generatePassword, grantsAdminOnlyWrite, INVITE_ACCEPT_WINDOW_MS, confirmLink, ConfirmQuery, EditInput, enabledStatus, InviteInput, inviteState, PasswordInput,
  resolveAccess, type MemberState,
} from '@/lib/users/rules';

const ME = 'u-me';
const ADMIN_ACTOR = { userId: ME, role: 'admin' as const };
const MANAGER = { userId: ME, role: 'staff' as const };
const state = (userId: string, role: MemberState['role'], status: MemberState['status'] = 'active', access: AccessMap = PRESET_ACCESS[role]): MemberState =>
  ({ userId, role, status, access });

describe('access form', () => {
  it('reads the matrix radios and treats missing or junk values as none', () => {
    const fd = new Map<string, string>([['access.forms', 'write'], ['access.leads', 'read'], ['access.stock', 'owner']]);
    const m = accessFromForm((k) => fd.get(k));
    expect(m.forms).toBe('write');
    expect(m.leads).toBe('read');
    expect(m.stock).toBe('none');
    expect(Object.keys(m)).toEqual([...AREAS]);
  });

  it('resolveAccess clamps and names the preset', () => {
    expect(resolveAccess('staff', PRESET_ACCESS.staff)).toEqual({ access: PRESET_ACCESS.staff, preset: 'staff' });
    expect(resolveAccess('staff', { ...PRESET_ACCESS.staff, users: 'read' }).preset).toBe('custom');
    expect(resolveAccess('factory', { ...PRESET_ACCESS.factory, forms: 'write' })).toEqual({ access: PRESET_ACCESS.factory, preset: 'factory' });
    expect(resolveAccess('admin', {}).preset).toBe('admin');
  });

  it('accessChanges lists [area, from, to] codes only', () => {
    expect(accessChanges(PRESET_ACCESS.staff, PRESET_ACCESS.reviewer)).toEqual([['forms', 'write', 'read'], ['leads', 'write', 'none'], ['stock', 'write', 'read']]);
  });
});

describe('inputs', () => {
  it('invite: normalises the email and needs a name, a preset and a method', () => {
    const ok = InviteInput.parse({ email: ' Person@Example.Invalid ', name: ' Pat ', role: 'staff', branch: '', method: 'link' });
    expect(ok).toEqual({ email: 'person@example.invalid', name: 'Pat', role: 'staff', branch: null, method: 'link' });
    expect(InviteInput.safeParse({ email: 'nope', name: 'x', role: 'staff', branch: null, method: 'email' }).success).toBe(false);
    expect(InviteInput.safeParse({ email: 'a@example.invalid', name: '', role: 'staff', branch: null, method: 'email' }).success).toBe(false);
    expect(InviteInput.safeParse({ email: 'a@example.invalid', name: 'x', role: 'owner', branch: null, method: 'email' }).success).toBe(false);
  });

  it('edit and password', () => {
    expect(EditInput.parse({ name: 'Pat', role: 'reviewer', branch: 'JHB' }).branch).toBe('JHB');
    expect(PasswordInput.safeParse({ password: 'short', confirm: 'short' }).success).toBe(false);
    expect(PasswordInput.safeParse({ password: 'long-enough-1', confirm: 'long-enough-2' }).success).toBe(false);
    expect(PasswordInput.safeParse({ password: 'long-enough-1', confirm: 'long-enough-1' }).success).toBe(true);
  });

  it('confirm links go to our /auth/confirm, then the set-password page', () => {
    const u = new URL(confirmLink('https://app.example.invalid', 'abc123_-'));
    expect(u.origin + u.pathname).toBe('https://app.example.invalid/auth/confirm');
    expect(Object.fromEntries(u.searchParams)).toEqual({ token_hash: 'abc123_-', type: 'invite', next: '/admin/account/password' });
    expect(ConfirmQuery.safeParse({ token_hash: 'abc123_-', type: 'invite' }).success).toBe(true);
    expect(ConfirmQuery.safeParse({ token_hash: 'a b<script>', type: 'invite' }).success).toBe(false);
    expect(ConfirmQuery.safeParse({ token_hash: 'abc123', type: 'phone_change' }).success).toBe(false);
    // L4: invite links only; magic, recovery and signup links are refused.
    for (const type of ['magiclink', 'recovery', 'email', 'signup']) expect(ConfirmQuery.safeParse({ token_hash: 'abc123', type }).success, type).toBe(false);
  });
});

describe('add user', () => {
  const base = { email: 'New@Example.Invalid', name: 'Nia New', role: 'staff', branch: '' };
  it('needs a temporary password of at least 12 characters unless one is generated', () => {
    expect(AddInput.safeParse({ ...base, password: 'short-pass1', generate: false }).success).toBe(false);
    expect(AddInput.safeParse({ ...base, generate: false }).success).toBe(false);
    expect(AddInput.parse({ ...base, password: 'long-enough-12', generate: false }).email).toBe('new@example.invalid');
    expect(AddInput.safeParse({ ...base, generate: true }).success).toBe(true);
  });

  it('generates 16 unambiguous characters, different each time', () => {
    const a = generatePassword();
    expect(a).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/);
    expect(generatePassword()).not.toBe(a);
    expect(generatePassword(24)).toHaveLength(24);
  });

  it('renders the audit rows', () => {
    const names = new Map([['u-1', 'Pat Admin'], ['u-2', 'Nia New']]);
    const row = { id: 1, created_at: '2026-10-01T10:00:00Z', actor_user: 'u-1', action: 'user.add', entity: 'user', entity_id: 'u-2', meta: { preset: 'staff' } };
    expect(describeRow(row, names).text).toBe('Pat Admin added Nia New as Staff with a temporary password');
    expect(describeRow({ ...row, actor_user: 'u-2', action: 'auth.password', meta: { first: true } }, names).text).toBe('Nia New replaced their temporary password');
  });
});

describe('security review fixes', () => {
  it('C1: only a brand-new account invite, verified within the hour, sets a first password without the current one', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    const at = (ms: number) => new Date(now - ms).toISOString();
    expect(acceptMode({ inviteNewAccount: true, inviteVerifiedAt: at(60_000) }, now)).toBe('new');
    expect(acceptMode({ inviteNewAccount: true, inviteVerifiedAt: at(INVITE_ACCEPT_WINDOW_MS + 1) }, now)).toBe('existing');
    expect(acceptMode({ inviteNewAccount: true, inviteVerifiedAt: null }, now)).toBe('existing');
    expect(acceptMode({ inviteNewAccount: false, inviteVerifiedAt: at(1000) }, now)).toBe('existing');
    expect(acceptMode({ inviteNewAccount: true, inviteVerifiedAt: new Date(now + 60_000).toISOString() }, now)).toBe('existing');
  });

  it('M1: a ban is account-wide, so it follows the other orgs', () => {
    expect(banDecision('disable', [])).toBe(true);
    expect(banDecision('disable', [{ status: 'active' }])).toBe(false);
    expect(banDecision('disable', [{ status: 'disabled' }, { status: 'invited' }])).toBe(true);
    expect(banDecision('lift', [])).toBe(true);
    expect(banDecision('lift', [{ status: 'disabled' }])).toBe(false);
    expect(banDecision('lift', [{ status: 'active' }])).toBe(true);
  });

  it('M2: only an admin grants Write on Users, Integrations or Settings', () => {
    const staff = PRESET_ACCESS.staff;
    for (const area of ['users', 'integrations', 'settings'] as const) {
      const next = { ...staff, [area]: 'write' as const };
      expect(grantsAdminOnlyWrite('staff', staff, next), area).toBe(true);
      expect(grantsAdminOnlyWrite('staff', null, next), area).toBe(true);
      expect(grantsAdminOnlyWrite('admin', staff, next), area).toBe(false);
      // Keeping or lowering an existing grant is fine.
      expect(grantsAdminOnlyWrite('staff', next, next), area).toBe(false);
      expect(changeError(MANAGER, state('u-5', 'staff'), { ...state('u-5', 'staff'), access: next }, 1), area).toBe('admin_only');
    }
    expect(grantsAdminOnlyWrite('staff', staff, { ...staff, users: 'read', leads: 'write' })).toBe(false);
  });
});

describe('guards', () => {
  it('nobody changes their own preset, access or status, or removes themselves; names are fine', () => {
    const me = state(ME, 'admin');
    expect(changeError(ADMIN_ACTOR, me, { ...me, role: 'staff', access: PRESET_ACCESS.staff }, 3)).toBe('self');
    expect(changeError(ADMIN_ACTOR, me, { ...me, status: 'disabled' }, 3)).toBe('self');
    expect(changeError(ADMIN_ACTOR, me, null, 3)).toBe('self');
    expect(changeError(ADMIN_ACTOR, me, { ...me }, 0)).toBeNull();
  });

  it('the last active admin cannot be disabled, demoted or removed', () => {
    const other = state('u-2', 'admin');
    expect(changeError(ADMIN_ACTOR, other, { ...other, status: 'disabled' }, 0)).toBe('last_admin');
    expect(changeError(ADMIN_ACTOR, other, { ...other, role: 'staff' }, 0)).toBe('last_admin');
    expect(changeError(ADMIN_ACTOR, other, null, 0)).toBe('last_admin');
    expect(changeError(ADMIN_ACTOR, other, null, 1)).toBeNull();
    // An invited or disabled admin is not "the last active admin".
    expect(changeError(ADMIN_ACTOR, state('u-3', 'admin', 'invited'), null, 0)).toBeNull();
    expect(changeError(ADMIN_ACTOR, state('u-4', 'staff'), null, 0)).toBeNull();
  });

  it('only an admin creates, changes or removes an admin account', () => {
    const other = state('u-2', 'admin');
    const staff = state('u-3', 'staff');
    expect(changeError(MANAGER, other, { ...other, status: 'disabled' }, 2)).toBe('admin_only');
    expect(changeError(MANAGER, other, null, 2)).toBe('admin_only');
    expect(changeError(MANAGER, staff, { ...staff, role: 'admin', access: PRESET_ACCESS.admin }, 2)).toBe('admin_only');
    expect(changeError(MANAGER, staff, { ...staff, access: { ...staff.access, users: 'read' } }, 2)).toBeNull();
    expect(changeError(MANAGER, staff, { ...staff, access: { ...staff.access, users: 'write' } }, 2)).toBe('admin_only');
    expect(changeError(ADMIN_ACTOR, staff, { ...staff, role: 'admin', access: PRESET_ACCESS.admin }, 2)).toBeNull();
  });

  it('enable returns to invited until the invite was accepted', () => {
    expect(enabledStatus(null)).toBe('invited');
    expect(enabledStatus('2026-10-01T00:00:00Z')).toBe('active');
  });
});

describe('activity log', () => {
  const names = new Map([['u-1', 'Pat Admin'], ['u-2', 'Sam Staff']]);
  const row = (action: string, extra: Partial<AuditRow> = {}): AuditRow => ({ id: 1, created_at: '2026-10-01T10:00:00Z', actor_user: 'u-1', action, entity: null, entity_id: null, meta: {}, ...extra });

  it('maps actions to areas', () => {
    expect(areaOf('auth.sign_in')).toBe('users');
    expect(areaOf('user.invite')).toBe('users');
    expect(areaOf('entry.status')).toBe('forms');
    expect(areaOf('entries.export')).toBe('forms');
    expect(areaOf('stock.dispatch')).toBe('stock');
    expect(areaOf('lead.assign')).toBe('leads');
    expect(areaOf('rfi.create_invoice')).toBe('integrations');
    expect(areaOf('settings.org')).toBe('settings');
    expect(areaOf('audit.export')).toBe('activity');
    expect(areaOf('something.else')).toBeNull();
    expect(areaOrFilter('users')).toBe('action.like.user.*,action.like.auth.*,action.like.admin.*');
    expect(areaOrFilter('home')).toBeNull();
  });

  it('renders rows in plain words with names, never ids or meta free text', () => {
    expect(describeRow(row('auth.sign_in'), names).text).toBe('Pat Admin signed in');
    expect(describeRow(row('auth.sign_in_failed', { actor_user: null, entity: 'user', entity_id: 'u-2' }), names).text).toBe('Failed sign-in for Sam Staff');
    expect(describeRow(row('auth.sign_in_failed', { actor_user: null, entity: 'auth' }), names).text).toBe('Failed sign-in for an unknown account');
    expect(describeRow(row('user.invite', { entity: 'user', entity_id: 'u-2', meta: { preset: 'staff' } }), names)).toEqual({ text: 'Pat Admin invited Sam Staff as Staff', href: '/admin/settings/users/u-2' });
    expect(describeRow(row('user.update', { entity: 'user', entity_id: 'u-2', meta: { preset_from: 'staff', preset_to: 'custom', changes: [['leads', 'write', 'read']] } }), names).text)
      .toBe('Pat Admin changed Sam Staff: Staff to Custom, Leads write to read');
    expect(describeRow(row('entry.status', { entity: 'entry', entity_id: 'e1', meta: { from: 'Submitted', to: 'Approved' } }), names))
      .toEqual({ text: "Pat Admin changed an entry's status from Submitted to Approved", href: '/admin/settings/activity/open/entry/e1' });
    expect(describeRow(row('stock.dispatch', { entity: 'stock_unit', entity_id: 'x1', meta: { vin: 'TESTVIN0000000001' } }), names))
      .toEqual({ text: 'Pat Admin dispatched unit TESTVIN0000000001', href: '/admin/stock/units?q=TESTVIN0000000001' });
    expect(describeRow(row('custom.thing', { actor_user: 'gone', entity: 'widget_box' }), names).text).toBe('A former member did custom thing on widget box');
    expect(describeRow(row('xero.sync.manual', { actor_user: null }), names).text).toBe('System ran a Xero sync');
  });

  it('links only well-formed ids to known record pages', () => {
    expect(hrefFor({ entity: 'lead', entity_id: 'abc-1', meta: null })).toBe('/admin/leads/abc-1');
    expect(hrefFor({ entity: 'lead', entity_id: '../../x', meta: null })).toBeNull();
    expect(hrefFor({ entity: 'unknown', entity_id: 'a', meta: null })).toBeNull();
  });

  it('parses filters leniently and builds links', () => {
    const f = parseFilters({ user: 'not-a-uuid', area: 'users', action: 'auth.sign_in', from: '2026-10-01', to: 'bad', q: 'x y', page: '3' });
    expect(f).toEqual({ area: 'users', action: 'auth.sign_in', from: '2026-10-01', page: 3 });
    expect(filterQuery(f, { page: 4 })).toBe('?area=users&action=auth.sign_in&from=2026-10-01&page=4');
    expect(filterQuery(parseFilters({}))).toBe('');
  });

  it('CSV quotes every cell and neutralises formulas', () => {
    const csv = toCsv([row('custom.=cmd', { entity: 'x', entity_id: '=1+1' })], names, () => '2026-10-01 12:00');
    expect(csv.split('\r\n')[0]).toBe('"Time","Who","Area","Action","What","Record","Record id"');
    expect(csv).toContain(`"'=1+1"`);
    expect(csv).toContain('"Pat Admin"');
  });
});

describe('inviteState', () => {
  it('is pending until accepted, then accepted', () => {
    expect(inviteState({ status: 'invited', invitedAt: 'a', acceptedAt: null })).toEqual({ label: 'Pending', color: 'yellow', at: 'a' });
    expect(inviteState({ status: 'active', invitedAt: 'a', acceptedAt: 'b' })).toEqual({ label: 'Accepted', color: 'green', at: 'b' });
  });
  it('keeps a disabled member who never accepted as pending', () => {
    expect(inviteState({ status: 'disabled', invitedAt: 'a', acceptedAt: null }).label).toBe('Pending');
    expect(inviteState({ status: 'disabled', invitedAt: 'a', acceptedAt: 'b' }).label).toBe('Accepted');
  });
});
