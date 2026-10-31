// Deal file "Download pack": which stored PDF versions go into the ZIP, their names and the manifest. Pure.
// Only the latest version of each (entry, template) is packed; the version number counts like the Generated documents
// list (v1, v2... per entry and template in creation order). File names carry the form kind, entry number and version
// only (e.g. RFI-12-v2.pdf), never the stored name, customer or other personal data.

/** Refuse a pack whose PDFs add up to more than this (bytes). */
export const PACK_MAX_BYTES = 100 * 1024 * 1024;

export const PACK_TOO_LARGE = 'This deal pack is over 100 MB. Download the documents one at a time instead.';
export const PACK_EMPTY = 'This deal has no generated documents to download yet.';

export interface PackDocumentRow {
  id: string;
  entry_id: string;
  template_number: number;
  storage_path: string;
  sha256: string | null;
  created_at: string;
}

export interface PackEntry {
  slug: string;
  number: number;
  /** The form's entries (and stored PDFs) are encrypted: packing one is a decrypted copy and is audited. */
  encrypted: boolean;
}

export interface PackFile {
  documentId: string;
  entryId: string;
  slug: string;
  entryNumber: number;
  templateNumber: number;
  /** "RFI", "DELIVERY-NOTE", "DEAL-COGNITO"... */
  kind: string;
  version: number;
  /** "RFI-12-v2.pdf" (unique within the pack). */
  fileName: string;
  storagePath: string;
  sha256: string;
  createdAt: string;
  encrypted: boolean;
}

/** Non-default templates get their own kind so two PDFs of one entry never share a name. */
const TEMPLATE_KIND: Record<number, string> = { 3: 'COGNITO', 4: 'COLLECTION-SHEET' };

const SHA = /^[0-9a-f]{64}$/;

/** Short kinds for the deal stage forms; other forms use their slug. */
const SLUG_KIND: Record<string, string> = {
  deal: 'DEAL',
  'request-for-invoice': 'RFI',
  'job-card': 'JOB-CARD',
  'trailer-inspection-checklist': 'INSPECTION',
  'release-form': 'RELEASE',
  'delivery-note': 'DELIVERY-NOTE',
};

/** "request-for-invoice" -> "RFI", "my-form" -> "MY-FORM"; only [A-Z0-9-] survive. */
export function kindOf(slug: string, template: number): string {
  const base = (SLUG_KIND[slug] ?? slug).toUpperCase().replace(/[^A-Z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'FORM';
  const extra = TEMPLATE_KIND[template];
  return extra ? `${base}-${extra}` : base;
}

const byCreated = (a: PackDocumentRow, b: PackDocumentRow) =>
  a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at < b.created_at ? -1 : 1;

/**
 * The files of a pack, in entry order (as `entries` lists them) then template number. Rows for entries not in
 * `entries` (not linked or not readable), without a valid sha256, or with a non-integer template are left out.
 */
export function planPack(rows: readonly PackDocumentRow[], entries: ReadonlyMap<string, PackEntry>): PackFile[] {
  const known = rows
    .filter((r) => entries.has(r.entry_id) && Number.isInteger(r.template_number))
    .sort(byCreated);
  const latest = new Map<string, { row: PackDocumentRow; version: number }>();
  for (const r of known) {
    const k = `${r.entry_id}:${r.template_number}`;
    latest.set(k, { row: r, version: (latest.get(k)?.version ?? 0) + 1 });
  }
  const order = [...entries.keys()];
  const picked = [...latest.values()]
    .filter(({ row }) => SHA.test((row.sha256 ?? '').toLowerCase()))
    .sort((a, b) => order.indexOf(a.row.entry_id) - order.indexOf(b.row.entry_id) || a.row.template_number - b.row.template_number);
  const used = new Set<string>();
  return picked.map(({ row, version }) => {
    const e = entries.get(row.entry_id)!;
    const kind = kindOf(e.slug, row.template_number);
    const stem = `${kind}-${e.number}-v${version}`;
    let fileName = `${stem}.pdf`;
    for (let n = 2; used.has(fileName); n++) fileName = `${stem}-${n}.pdf`;
    used.add(fileName);
    return {
      documentId: row.id,
      entryId: row.entry_id,
      slug: e.slug,
      entryNumber: e.number,
      templateNumber: row.template_number,
      kind,
      version,
      fileName,
      storagePath: row.storage_path,
      sha256: (row.sha256 ?? '').toLowerCase(),
      createdAt: row.created_at,
      encrypted: e.encrypted,
    };
  });
}

/** Encrypted entries in the pack, one each (each gets an entry.decrypt audit row before anything is read). */
export function encryptedEntries(files: readonly PackFile[]): Array<{ entryId: string; slug: string; number: number }> {
  const seen = new Map<string, { entryId: string; slug: string; number: number }>();
  for (const f of files) if (f.encrypted && !seen.has(f.entryId)) seen.set(f.entryId, { entryId: f.entryId, slug: f.slug, number: f.entryNumber });
  return [...seen.values()];
}

/** Safe ZIP name: "deal-pack-QU-10482.zip" (quote numbers are not personal data; other characters are dropped). */
export function packFileName(quoteNo: string): string {
  const q = quoteNo.replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return q ? `deal-pack-${q}.zip` : 'deal-pack.zip';
}

/** The pack route of a deal file. */
export function packHref(quoteNo: string): string {
  return `/admin/deal-files/${encodeURIComponent(quoteNo)}/pack`;
}

/** True once the running total of PDF bytes is over the cap. */
export function overPackLimit(totalBytes: number, max = PACK_MAX_BYTES): boolean {
  return totalBytes > max;
}

/** manifest.txt: one tab-separated line per file (kind, entry number, version, sha256, file). No personal data. */
export function packManifest(quoteNo: string, files: readonly PackFile[], generatedAtUtc: string): string {
  const lines = [
    `Deal pack for quote ${quoteNo.replace(/[\r\n\t]+/g, ' ')}`,
    `Generated ${generatedAtUtc} (UTC)`,
    `Documents: ${files.length}`,
    '',
    ['kind', 'entry', 'version', 'sha256', 'file'].join('\t'),
    ...files.map((f) => [f.kind, String(f.entryNumber), `v${f.version}`, f.sha256, f.fileName].join('\t')),
  ];
  return `${lines.join('\n')}\n`;
}

/** The deal.pack_download audit row: ids and counts only. */
export function packAuditRow(member: { orgId: string; userId: string }, dealFileId: string, quoteNo: string, files: readonly PackFile[]) {
  return {
    org_id: member.orgId,
    actor_user: member.userId,
    action: 'deal.pack_download',
    entity: 'deal_file',
    entity_id: dealFileId,
    meta: { quote_no: quoteNo, documents: files.length, document_ids: files.map((f) => f.documentId), entry_ids: [...new Set(files.map((f) => f.entryId))] },
  };
}
