import { Tabs } from '@/components/ui/Tabs';
import type { Member } from '@/lib/security/can';
import { settingsTabs, type SettingsTab } from '@/lib/ui/settings-tabs';

/** Settings section tabs, limited to what the member can read. */
export function SettingsTabs({ member, current }: { member: Member; current: SettingsTab }) {
  return <Tabs label="Settings sections" items={settingsTabs(member).map((t) => ({ href: t.href, label: t.label, current: t.key === current }))} />;
}
