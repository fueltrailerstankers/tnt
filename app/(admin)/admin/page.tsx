import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { DesktopHome } from '@/components/home/DesktopHome';
import { HomeSkeleton } from '@/components/home/HomeSkeleton';
import { PhoneHome } from '@/components/home/PhoneHome';
import { greeting, homeDateLine, phoneDateLine } from '@/lib/home/greeting';
import { loadHome } from '@/lib/home/load';
import { can, type Member } from '@/lib/security/can';
import { visibleNav } from '@/lib/ui/nav';
import { requirePerm } from '@/lib/security/require';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home · Trailers & Tankers' };

/** Home dashboard (handoff Home, HomeDark, PhoneHome). Server-rendered per request; times in SAST. */
export default async function AdminHome() {
  const member = await requirePerm('admin.access');
  // Home is an access area (M7): without it, start on the first menu the member can read.
  if (!can(member, 'home.read')) redirect(visibleNav(member)[0]?.href ?? '/admin/account');
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent member={member} />
    </Suspense>
  );
}

async function HomeContent({ member }: { member: Member }) {
  const now = new Date();
  const data = await loadHome(member, now);
  const hello = greeting(now, data.name);
  return (
    <>
      <DesktopHome data={data} greeting={hello} dateLine={homeDateLine(now)} />
      <PhoneHome data={data} greeting={hello} dateLine={phoneDateLine(now)} />
    </>
  );
}
