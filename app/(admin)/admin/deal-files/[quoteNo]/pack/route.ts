import { strToU8 } from 'fflate';
import { forbidden, notFound } from 'next/navigation';
import { buildTimeline, stageEntryIds, type TimelineEntryRow } from '@/lib/deal-files/timeline';
import {
  encryptedEntries, overPackLimit, PACK_EMPTY, PACK_TOO_LARGE, packAuditRow, packFileName, packManifest, planPack,
  type PackDocumentRow, type PackEntry,
} from '@/lib/deal-view/pack';
import { dealParam } from '@/lib/deal-view/search';
import { zipStream } from '@/lib/deal-view/zip-stream';
import { decryptAuditRow } from '@/lib/entry-view/protected';
import { loadForms } from '@/lib/forms/forms';
import { readStoredDocument } from '@/lib/pdf/documents';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/**
 * Deal file "Download pack" (deals.read + entries.read, like the page's Generated documents): a ZIP of the latest
 * stored version of each PDF of the deal's linked entries, plus manifest.txt. Everything is selected through the
 * caller's RLS-scoped client; the service role only reads the stored objects and writes the audit rows. Encrypted
 * entries (DEAL, Delivery Note) get an entry.decrypt row each before their PDFs are read, and the pack refuses if a
 * row cannot be written. The PDFs are read (sha256-checked) up to PACK_MAX_BYTES, then the ZIP is streamed.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ quoteNo: string }> }) {
  const member = await requirePerm('deals.read');
  if (!can(member, 'entries.read')) forbidden();
  const { quoteNo: raw } = await params;
  const key = dealParam(raw);
  if (!key) notFound();

  const userDb = await createClient();
  const { data: file } = await userDb.from('deal_files')
    .select('id, quote_no, deal_entry_id, rfi_entry_id, job_card_entry_id, inspection_entry_id, release_entry_id, delivery_entry_id')
    .eq('org_id', member.orgId).eq('quote_no', key).maybeSingle();
  if (!file) notFound();

  const entryIds = stageEntryIds(file);
  if (!entryIds.length) return text(PACK_EMPTY, 404);
  // Metadata only: entry data is never selected here.
  const [{ data: entryRows }, forms, { data: docRows }] = await Promise.all([
    userDb.from('entries').select('id, number, status, summary, created_at, updated_at, form_id').eq('org_id', member.orgId).in('id', entryIds),
    loadForms(userDb, member.orgId),
    userDb.from('entry_documents').select('id, entry_id, template_number, storage_path, sha256, created_at').eq('org_id', member.orgId).in('entry_id', entryIds),
  ]);
  const formBySlug = new Map(forms.map((f) => [f.slug, f]));
  const entries = new Map<string, PackEntry>();
  for (const s of buildTimeline(file, (entryRows ?? []) as TimelineEntryRow[], forms)) {
    const form = formBySlug.get(s.slug);
    if (s.entry && form) entries.set(s.entry.id, { slug: s.slug, number: s.entry.number, encrypted: form.encrypt });
  }
  const files = planPack((docRows ?? []) as PackDocumentRow[], entries);
  if (!files.length) return text(PACK_EMPTY, 404);

  const db = createAdminClient();
  // A PDF of an encrypted entry is a decrypted copy: audited like opening the entry (ids only), before any read.
  const opened = encryptedEntries(files).map((e) => decryptAuditRow(member, e.entryId, e.slug, e.number, 'document'));
  if (opened.length) {
    const { error } = await db.from('audit_log').insert(opened);
    if (error) return text('Could not record the download.', 500);
  }

  const parts: Array<{ name: string; data: Uint8Array }> = [];
  let total = 0;
  for (const f of files) {
    const form = formBySlug.get(f.slug)!;
    const bytes = await readStoredDocument(db, form, f.storagePath, f.sha256);
    if (!bytes) return text('A stored document failed its integrity check.', 500);
    total += bytes.length;
    if (overPackLimit(total)) return text(PACK_TOO_LARGE, 413);
    parts.push({ name: f.fileName, data: new Uint8Array(bytes) });
  }

  const { error } = await db.from('audit_log').insert(packAuditRow(member, file.id, file.quote_no, files));
  if (error) return text('Could not record the download.', 500);

  const manifest = packManifest(file.quote_no, files, new Date().toISOString());
  return new Response(zipStream([{ name: 'manifest.txt', data: strToU8(manifest) }, ...parts]), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${packFileName(file.quote_no)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
