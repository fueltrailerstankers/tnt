import { loadOrg } from '@/lib/forms/org';
import { requirePerm } from '@/lib/security/require';
import { todayIn } from '@/lib/spec/values';
import { dealQuery, DISPATCH_COPY } from '@/lib/stock/dispatch';
import { loadLocations, loadModels, lookupDeal } from '@/lib/stock/lookup';
import { createClient } from '@/lib/supabase/server';
import { DispatchForm } from './dispatch-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dispatch a unit · Stock · Trailers & Tankers' };

/** Factory dispatch (stock plan 7.4). ?year=&number= opens existing-sequence mode with Find unit already run. */
export default async function StockDispatch({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requirePerm('stock.dispatch');
  const sp = await searchParams;
  const db = await createClient();
  const [locations, models, org] = await Promise.all([loadLocations(db, member.orgId), loadModels(db, member.orgId), loadOrg(db, member.orgId)]);
  const today = todayIn(org.timezone);
  const q = dealQuery(sp.year, sp.number);
  const initial = q ? { ...q, find: await lookupDeal(db, member.orgId, q.year, q.number, locations) } : null;

  return (
    <section className="mx-auto max-w-4xl space-y-5">
      <header className="min-w-0">
        <p className="text-label uppercase text-accent-text">{DISPATCH_COPY.eyebrow}</p>
        <h1 className="text-h1">{DISPATCH_COPY.title}</h1>
        <p className="text-body text-fg-muted">{DISPATCH_COPY.subtitle}</p>
      </header>
      <DispatchForm
        models={models.filter((m) => m.active).map((m) => ({ part: m.part_number, description: m.description }))}
        locations={locations.map((l) => ({ id: l.id, name: l.name, isFactory: l.is_factory }))}
        today={today}
        currentYear={Number(today.slice(0, 4))}
        initial={initial}
      />
    </section>
  );
}
