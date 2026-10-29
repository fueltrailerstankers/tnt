import type { IconName } from '@/components/ui/Icon';

export interface ShellNavItem {
  key: string;
  label: string;
  href: string;
  icon: IconName;
  tab: boolean;
  /** Badge text, empty for none. */
  badge: string;
}

export interface ShellUser {
  name: string;
  initials: string;
  role: string;
}

export interface ShellXero {
  connected: boolean;
  /** "14:30 SAST" style label or null when nothing has synced. */
  lastSync: string | null;
}
