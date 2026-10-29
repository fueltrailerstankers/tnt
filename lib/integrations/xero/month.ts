// Month reconciliation maths. Pure.

export interface MonthLine {
  entity: string;
  currency: string;
  xeroCount: number;
  mirrorCount: number;
  xeroTotal: number;
  mirrorTotal: number;
  match: boolean;
}

export function monthBounds(month: string): { first: string; next: string; last: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Month must be YYYY-MM');
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const nextDate = new Date(Date.UTC(y, m, 1));
  const lastDate = new Date(Date.UTC(y, m, 0));
  return { first, next: nextDate.toISOString().slice(0, 10), last: lastDate.toISOString().slice(0, 10) };
}

type Item = { amount: number | string | null; currency: string | null };

const cents = (v: number | string | null) => Math.round(Number(v ?? 0) * 100);

/** Count and total per currency on both sides; a line matches when count and total (to the cent) agree. */
export function summarise(entity: string, xero: Item[], mirror: Item[]): MonthLine[] {
  const group = (list: Item[]) => {
    const m = new Map<string, { n: number; c: number }>();
    for (const i of list) {
      const k = (i.currency ?? '???').trim();
      const g = m.get(k) ?? { n: 0, c: 0 };
      g.n += 1;
      g.c += cents(i.amount);
      m.set(k, g);
    }
    return m;
  };
  const x = group(xero);
  const y = group(mirror);
  const currencies = [...new Set([...x.keys(), ...y.keys()])].sort();
  if (!currencies.length) return [{ entity, currency: '-', xeroCount: 0, mirrorCount: 0, xeroTotal: 0, mirrorTotal: 0, match: true }];
  return currencies.map((cur) => {
    const a = x.get(cur) ?? { n: 0, c: 0 };
    const b = y.get(cur) ?? { n: 0, c: 0 };
    return { entity, currency: cur, xeroCount: a.n, mirrorCount: b.n, xeroTotal: a.c / 100, mirrorTotal: b.c / 100, match: a.n === b.n && a.c === b.c };
  });
}
