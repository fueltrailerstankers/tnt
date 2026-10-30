import { adminForm } from '@/lib/admin/context';

export const dynamic = 'force-dynamic';

/** Export JSON: the published FormSpec (or the draft with ?draft=1). forms.manage; audited with ids only. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { member, db, form } = await adminForm(slug, 'forms.manage');
  const draft = new URL(req.url).searchParams.get('draft') === '1' && form.draftSpec ? form.draftSpec : null;
  await db.from('audit_log').insert({ org_id: member.orgId, actor_user: member.userId, action: 'form.export', entity: 'form', entity_id: form.id, meta: { draft: !!draft, version: form.version ?? 1 } });
  const body = JSON.stringify(draft ?? form.spec, null, 2);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}${draft ? '-draft' : `-v${form.version ?? 1}`}.json"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
