import { Suspense } from 'react';
import { DesktopHome } from '@/components/home/DesktopHome';
import { HomeSkeleton } from '@/components/home/HomeSkeleton';
import { PhoneHome } from '@/components/home/PhoneHome';
import { greeting, homeDateLine, phoneDateLine } from '@/lib/home/greeting';
import { loadHome } from '@/lib/home/load';
import type { Member } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home · Trailers & Tankers' };

/** Home dashboard (handoff Home, HomeDark, PhoneHome). Server-rendered per request; times in SAST. */
export default async function AdminHome() {
  const member = await requirePerm('admin.access');
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
