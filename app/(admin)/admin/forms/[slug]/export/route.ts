import ExcelJS from 'exceljs';
import { adminForm } from '@/lib/admin/context';
import { EXPORT_LIMIT, exportTable, parseGridQuery, safeCell, toCsv } from '@/lib/admin/grid';
import { listEntries } from '@/lib/admin/list';

export const dynamic = 'force-dynamic';

/** CSV/XLSX export of the current grid filter. Needs entries.export; every export is audited (ids only). */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { member, userDb, db, form, org } = await adminForm(slug, 'entries.export');
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams.entries());
  const q = parseGridQuery(form.spec, sp);
  const { rows } = await listEntries(userDb, form, q, org.timezone, EXPORT_LIMIT, 0);
  const table = exportTable(form.spec, rows, org.timezone, member.role === 'admin');
  const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  await db.from('audit_log').insert({
    org_id: member.orgId, actor_user: member.userId, action: 'entries.export', entity: 'form', entity_id: form.id,
    meta: { format, rows: rows.length, view: q.view },
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${slug}-${stamp}`;
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

  if (format === 'csv') {
    return new Response(toCsv(table), {
      headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${base}.csv"` },
    });
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(form.spec.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  for (const row of table) ws.addRow(row.map(safeCell));
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      ...headers,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${base}.xlsx"`,
    },
  });
}
