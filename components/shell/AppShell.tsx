import type { ReactNode } from 'react';
import type { Member } from '@/lib/security/can';
import { createClient } from '@/lib/supabase/server';
import { badgeLabel, phoneTabKeys, visibleNav } from '@/lib/ui/nav';
import { searchAccessOf } from '@/lib/ui/search';
import { initials, loadShellData } from '@/lib/ui/shell-data';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { ShellFrame } from './ShellFrame';
import type { ShellNavItem } from './types';

const SAST = 'Africa/Johannesburg';

/** "14:30 SAST" in Africa/Johannesburg. Stored times are UTC. */
export function sastTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: SAST, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  return `${t} SAST`;
}

/** Server wrapper: loads what the shell shows (counts, user, sync) and hands plain props to the client frame. */
export async function AppShell({ member, signOut, children }: { member: Member; signOut: () => Promise<void>; children: ReactNode }) {
  const db = await createClient();
  const data = await loadShellData(db, member);
  const counts = { tasks: data.tasks, leads: 0 };
  const nav = visibleNav(member);
  const tabKeys = phoneTabKeys(nav);
  const items: ShellNavItem[] = nav.map((n) => ({
    key: n.key,
    label: n.label,
    href: n.href,
    icon: n.icon,
    tab: tabKeys.has(n.key),
    badge: n.badge ? badgeLabel(counts[n.badge]) : '',
  }));
  const name = data.userName?.trim() || 'Account';
  // Toasts for every staff page (useToast in client components); the provider owns the live regions.
  return (
    <ToastProvider>
      <ShellFrame
        items={items}
        user={{ name, initials: initials(data.userName, member.role), role: member.role }}
        xero={data.xero ? { connected: data.xero.connected, lastSync: sastTime(data.xero.lastSync) } : null}
        searchAccess={searchAccessOf(member)}
        signOut={signOut}
      >
        {children}
      </ShellFrame>
    </ToastProvider>
  );
}
