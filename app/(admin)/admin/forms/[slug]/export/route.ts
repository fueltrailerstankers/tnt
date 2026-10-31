import ExcelJS from 'exceljs';
import { adminForm } from '@/lib/admin/context';
import { clearExportTable, EXPORT_LIMIT, ExportParams, exportTable, parseGridQuery, safeCell, toCsv } from '@/lib/admin/grid';
import { listEntries, listEntriesByNumbers } from '@/lib/admin/list';

export const dynamic = 'force-dynamic';

/**
 * CSV/XLSX export of the current grid filter, or of the selected entries (sel=<numbers>). Needs entries.export;
 * every export is audited (ids and counts only). Encrypted forms export only their clear columns (number, status,
 * timestamps, summary): field values are never decrypted for a bulk export.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { member, userDb, db, form, org } = await adminForm(slug, 'entries.export');
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams.entries());
  const opts = ExportParams.safeParse({ format: sp.format, sel: sp.sel });
  if (!opts.success) return new Response('Invalid export request', { status: 400, headers: { 'Cache-Control': 'no-store' } });
  const { format, sel } = opts.data;
  const q = parseGridQuery(form.spec, sp);
  const decrypt = !form.encrypt;
  const rows = sel
    ? await listEntriesByNumbers(userDb, form, sel, { decrypt })
    : (await listEntries(userDb, form, q, org.timezone, EXPORT_LIMIT, 0, { decrypt })).rows;
  const table = form.encrypt ? clearExportTable(rows, org.timezone) : exportTable(form.spec, rows, org.timezone, member.role === 'admin');
  await db.from('audit_log').insert({
    org_id: member.orgId, actor_user: member.userId, action: 'entries.export', entity: 'form', entity_id: form.id,
    meta: { format, rows: rows.length, view: q.view, selected: sel ? sel.length : null },
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
