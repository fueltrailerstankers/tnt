import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll } from '@/lib/db/paging';
import { XeroReader } from './client';
import { loadConnection } from './connection';
import { mapInvoice, mapPayment, mapQuote } from './mappers';
import { monthBounds, summarise, type MonthLine } from './month';

type J = Record<string, unknown>;

/**
 * M2 acceptance check: a month's quotes, invoices and payments, counted and totalled per currency, live from
 * Xero (GET only) and from the mirror. Totals only; no names or numbers leave this function.
 */
export async function monthCheck(db: SupabaseClient, orgId: string, month: string): Promise<MonthLine[]> {
  const conn = await loadConnection(db, orgId);
  if (!conn || conn.status !== 'connected') throw new Error('Xero is not connected');
  const { first, next, last } = monthBounds(month);
  const reader = new XeroReader(db, conn);
  const [y, m] = month.split('-').map(Number);
  const [ny, nm] = next.split('-').map(Number);
  const where = `Date >= DateTime(${y}, ${m}, 1) && Date < DateTime(${ny}, ${nm}, 1)`;

  async function pages(path: string, key: string, params: Record<string, string>, paged: boolean): Promise<J[]> {
    const out: J[] = [];
    for (let page = 1; page < 200; page++) {
      const res = await reader.get<J>(path, { params: { ...params, page: String(page), ...(paged ? { pageSize: '1000' } : {}) } });
      const list = (res?.[key] as J[] | undefined) ?? [];
      out.push(...list);
      if (list.length < (paged ? 1000 : 100)) break;
    }
    return out;
  }

  const [xq, xi, xp] = await Promise.all([
    pages('/Quotes', 'Quotes', { DateFrom: first, DateTo: last }, false),
    pages('/Invoices', 'Invoices', { where }, true),
    pages('/Payments', 'Payments', { where }, true),
  ]);
  await reader.flushRate();

  type Row = { total?: number; amount?: number; currency_code: string | null };
  const [mq, mi, mp] = await Promise.all([
    fetchAll<Row>((a, b) => db.from('xero_quotes').select('total, currency_code').eq('org_id', orgId).gte('quote_date', first).lt('quote_date', next).order('quote_id').range(a, b)),
    fetchAll<Row>((a, b) => db.from('xero_invoices').select('total, currency_code').eq('org_id', orgId).gte('invoice_date', first).lt('invoice_date', next).order('invoice_id').range(a, b)),
    fetchAll<Row>((a, b) => db.from('xero_payments').select('amount, currency_code').eq('org_id', orgId).gte('payment_date', first).lt('payment_date', next).order('payment_id').range(a, b)),
  ]);

  return [
    ...summarise('Quotes', xq.map((j) => mapQuote(j).row).map((r) => ({ amount: r.total, currency: r.currency_code })), mq.map((r) => ({ amount: r.total ?? null, currency: r.currency_code }))),
    ...summarise('Invoices', xi.map((j) => mapInvoice(j).row).map((r) => ({ amount: r.total, currency: r.currency_code })), mi.map((r) => ({ amount: r.total ?? null, currency: r.currency_code }))),
    ...summarise('Payments', xp.map(mapPayment).map((r) => ({ amount: r.amount, currency: r.currency_code })), mp.map((r) => ({ amount: r.amount ?? null, currency: r.currency_code }))),
  ];
}
