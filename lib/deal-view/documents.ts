// Deal file "Generated documents": the stored PDF versions of the entries a deal file links. Pure.
// Versions are immutable rows (entry_documents); v1, v2... count per entry and template in creation order.

export interface DocumentRow {
  id: string;
  entry_id: string;
  template_number: number;
  name: string | null;
  sha256: string | null;
  created_at: string;
}

export interface DocumentEntry {
  slug: string;
  number: number;
  formName: string;
}

export interface DealDocument {
  id: string;
  /** "Delivery Note · v1". */
  title: string;
  version: number;
  createdAt: string;
  /** "9f3c…a71e"; empty without a hash. */
  sha: string;
  /** Stored-version download (the entry page's document route; entries.read). */
  href: string;
}

const TEMPLATE_TITLE: Record<number, string> = { 3: 'DEAL (Cognito template)', 4: 'Collection sheet' };

/** "9f3c…a71e" for a hex sha256. */
export function shortSha(sha: string | null | undefined): string {
  const s = (sha ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{8,}$/.test(s)) return '';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/** Newest first. Rows for entries not in `entries` (not linked, or not readable) are dropped. */
export function dealDocuments(rows: readonly DocumentRow[], entries: ReadonlyMap<string, DocumentEntry>): DealDocument[] {
  const known = rows.filter((r) => entries.has(r.entry_id) && Number.isInteger(r.template_number));
  const asc = [...known].sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at < b.created_at ? -1 : 1));
  const seen = new Map<string, number>();
  const out: DealDocument[] = asc.map((r) => {
    const k = `${r.entry_id}:${r.template_number}`;
    const version = (seen.get(k) ?? 0) + 1;
    seen.set(k, version);
    const e = entries.get(r.entry_id)!;
    const base = TEMPLATE_TITLE[r.template_number] ?? e.formName;
    return {
      id: r.id,
      title: `${base} #${e.number} · v${version}`,
      version,
      createdAt: r.created_at,
      sha: shortSha(r.sha256),
      href: `/admin/forms/${encodeURIComponent(e.slug)}/entries/${e.number}/documents/${r.template_number}?version=${encodeURIComponent(r.id)}`,
    };
  });
  return out.reverse();
}
