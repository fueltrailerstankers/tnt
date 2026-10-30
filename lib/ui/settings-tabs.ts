import { can, type Member, type Permission } from '@/lib/security/can';

// Settings tabs (docs/M7.md section 3). Each tab is its own area: Organisation and Forms are Settings, Users & access
// is Users, Activity log is Activity. A member sees the tabs they can read. Pure.

export type SettingsTab = 'organisation' | 'users' | 'activity' | 'forms';

export const SETTINGS_TABS: ReadonlyArray<{ key: SettingsTab; label: string; href: string; perm: Permission }> = [
  { key: 'organisation', label: 'Organisation', href: '/admin/settings', perm: 'settings.read' },
  { key: 'users', label: 'Users & access', href: '/admin/settings/users', perm: 'users.read' },
  { key: 'activity', label: 'Activity log', href: '/admin/settings/activity', perm: 'audit.read' },
  { key: 'forms', label: 'Forms', href: '/admin/settings/forms', perm: 'settings.read' },
];

export function settingsTabs(member: Member | null) {
  return SETTINGS_TABS.filter((t) => can(member, t.perm));
}
