import { notFound } from 'next/navigation';
import { adminForm } from '@/lib/admin/context';
import { decryptAuditRow } from '@/lib/entry-view/protected';
import { loadEntryByNumber } from '@/lib/forms/entries';
import { ensureDocument, readStoredDocument } from '@/lib/pdf/documents';

export const dynamic = 'force-dynamic';

/** PDF download: the current version (generated if the entry changed), or a stored version by id. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string; number: string; template: string }> }) {
  const { slug, number, template } = await params;
  const { member, userDb, db, form, org } = await adminForm(slug, 'entries.read');
  const entry = await loadEntryByNumber(userDb, form, Number.parseInt(number, 10));
  if (!entry) notFound();
  // Encrypted forms: a PDF of the entry is a decrypted copy, so it is audited like opening the entry (ids only).
  if (form.encrypt) {
    const { error } = await db.from('audit_log').insert(decryptAuditRow(member, entry.id, form.slug, entry.number, 'document'));
    if (error) return new Response('Could not record the download.', { status: 500 });
  }
  const t = Number.parseInt(template, 10);
  const version = new URL(req.url).searchParams.get('version');

  let name: string;
  let bytes: Buffer;
  if (version) {
    const { data } = await userDb.from('entry_documents').select('storage_path, name, sha256, template_number').eq('id', version).eq('entry_id', entry.id).maybeSingle();
    if (!data || data.template_number !== t) notFound();
    const b = await readStoredDocument(db, form, data.storage_path, data.sha256);
    if (!b) return new Response('Stored document failed its integrity check.', { status: 500 });
    name = data.name;
    bytes = b;
  } else {
    const doc = await ensureDocument(db, form, entry, t, org.timezone, member.userId).catch(() => null);
    if (!doc) notFound();
    name = doc.name;
    bytes = doc.bytes;
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name.replace(/"/g, '')}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
