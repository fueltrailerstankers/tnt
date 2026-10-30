import { toCsv } from '@/lib/admin/grid';
import { ForbiddenError } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { EXPORT_CHUNK, EXPORT_MAX_ROWS, exportAuditRow, parseRegisterQuery, unitsCsvTable, type UnitRow } from '@/lib/stock/register';
import { loadLocations, loadModels, selectUnits } from '@/lib/stock/register-query';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * CSV of the register's current filter (stock plan 7.3). Needs stock.export. Reads through the caller's RLS, then
 * writes one audit row 'stock.export' with the row count and filter kinds only (no search text).
 */
export async function GET(req: Request) {
  let member;
  try {
    member = await requirePerm('stock.export');
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response('Forbidden', { status: 403 });
    throw e;
  }
  const db = await createClient();
  const [locations, models] = await Promise.all([loadLocations(db, member.orgId), loadModels(db, member.orgId)]);
  const rq = parseRegisterQuery(Object.fromEntries(new URL(req.url).searchParams.entries()), locations.map((l) => l.id));

  const rows: UnitRow[] = [];
  for (let from = 0; from < EXPORT_MAX_ROWS; from += EXPORT_CHUNK) {
    const chunk = await selectUnits(db, member.orgId, rq, locations, { from, to: Math.min(from + EXPORT_CHUNK, EXPORT_MAX_ROWS) - 1 });
    if (chunk.error) return new Response('Units could not be loaded. Try again.', { status: 502 });
    rows.push(...chunk.rows);
    if (chunk.rows.length < EXPORT_CHUNK) break;
  }

  const desc = new Map(models.map((m) => [m.part_number, m.description]));
  const loc = new Map(locations.map((l) => [l.id, l.name]));
  const csv = toCsv(unitsCsvTable(rows, (p) => desc.get(p), (id) => loc.get(id)));

  // audit_log has no client insert policy: the service role writes the row, after the permission check.
  // No audit row, no export.
  const { error: auditError } = await createAdminClient().from('audit_log').insert(exportAuditRow(member, rq, rows.length));
  if (auditError) return new Response('The export could not be recorded. Try again.', { status: 502 });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="stock-units-${stamp}.csv"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
