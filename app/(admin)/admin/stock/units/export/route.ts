import { toCsv } from '@/lib/admin/grid';
import { ForbiddenError } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { exportAuditRow, exportTooManyMessage, parseRegisterQuery, unitsCsvTable } from '@/lib/stock/register';
import { loadLocations, loadModels, readExport } from '@/lib/stock/register-query';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

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
  const [locs, mods] = await Promise.all([loadLocations(db, member.orgId), loadModels(db, member.orgId)]);
  // Without them the location and model filters would be dropped silently: refuse instead of exporting more.
  if (locs.error || mods.error) return text('Units could not be loaded. Try again.', 502);
  const locations = locs.data;
  const models = mods.data;
  const rq = parseRegisterQuery(Object.fromEntries(new URL(req.url).searchParams.entries()), locations.map((l) => l.id), models.map((m) => m.part_number));

  const read = await readExport(db, member.orgId, rq, locations);
  if (read.kind === 'error') return text('Units could not be loaded. Try again.', 502);
  if (read.kind === 'too_many') return text(exportTooManyMessage(read.count), 422);
  const rows = read.rows;

  const desc = new Map(models.map((m) => [m.part_number, m.description]));
  const loc = new Map(locations.map((l) => [l.id, l.name]));
  const csv = toCsv(unitsCsvTable(rows, (p) => desc.get(p), (id) => loc.get(id)));

  // audit_log has no client insert policy: the service role writes the row, after the permission check.
  // No audit row, no export.
  const { error: auditError } = await createAdminClient().from('audit_log').insert(exportAuditRow(member, rq, rows.length));
  if (auditError) return text('The export could not be recorded. Try again.', 502);

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
