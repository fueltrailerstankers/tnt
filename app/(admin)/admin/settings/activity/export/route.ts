import { formatDateTime } from '@/lib/admin/grid';
import { parseFilters, toCsv, type AuditRow } from '@/lib/activity/describe';
import { loadActivity } from '@/lib/activity/query';
import { loadOrg } from '@/lib/forms/org';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { audit, memberNames } from '@/lib/users/service';

export const dynamic = 'force-dynamic';

const PAGE = 1000;       // PostgREST's default max rows per request
const MAX_ROWS = 10_000;

/** CSV of the filtered activity log (newest first, up to 10,000 rows). The export itself is audited. */
export async function GET(req: Request) {
  const member = await requirePerm('audit.read');
  const f = parseFilters(Object.fromEntries(new URL(req.url).searchParams.entries()));
  const db = await createClient();
  const org = await loadOrg(db, member.orgId);
  const rows: AuditRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const page = await loadActivity(db, member.orgId, f, org.timezone, PAGE, offset);
    rows.push(...page.rows);
    if (page.rows.length < PAGE) break;
  }
  const names = await memberNames(member.orgId);
  await audit(member.orgId, member.userId, 'audit.export', null, {
    rows: rows.length, user: f.user ?? null, area: f.area ?? null, action: f.action ?? null, from: f.from ?? null, to: f.to ?? null, q: f.q ?? null,
  }, 'audit_log');
  const csv = toCsv(rows, names, (iso) => formatDateTime(iso, org.timezone));
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="activity-${stamp}.csv"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
