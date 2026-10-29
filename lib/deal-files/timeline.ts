// Deal file timeline: the stages of one trailer from deal to delivery, in business order. Pure.
// Reads only entry metadata (number, status, summary, times); entry data is never needed here.

export const DEAL_STAGES = [
  { key: 'deal', label: 'Deal', short: 'Deal', slug: 'deal', field: 'deal_entry_id' },
  { key: 'rfi', label: 'Request For Invoice', short: 'RFI', slug: 'request-for-invoice', field: 'rfi_entry_id' },
  { key: 'job', label: 'Job Card', short: 'Job card', slug: 'job-card', field: 'job_card_entry_id' },
  { key: 'inspection', label: 'Trailer Inspection', short: 'Inspection', slug: 'trailer-inspection-checklist', field: 'inspection_entry_id' },
  { key: 'release', label: 'Release Form', short: 'Release', slug: 'release-form', field: 'release_entry_id' },
  { key: 'delivery', label: 'Delivery Note', short: 'Delivery', slug: 'delivery-note', field: 'delivery_entry_id' },
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];
export type StageField = DealStage['field'];
export type DealFileStages = { [K in StageField]: string | null };

export interface TimelineEntryRow {
  id: string;
  number: number;
  status: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
  form_id: string;
}
export interface TimelineFormRow {
  id: string;
  slug: string;
  name: string;
}

export interface TimelineStage {
  key: DealStage['key'];
  label: string;
  slug: string;
  entry: {
    id: string;
    number: number;
    status: string;
    summary: string | null;
    createdAt: string;
    updatedAt: string;
    formName: string;
    href: string;
  } | null;
}

/** Entry ids a deal file links to, in stage order, without blanks or repeats. */
export function stageEntryIds(file: DealFileStages): string[] {
  return [...new Set(DEAL_STAGES.map((s) => file[s.field]).filter((v): v is string => !!v))];
}

/** Which stages exist, in stage order (for the compact ticks on the list). */
export function stagesPresent(file: DealFileStages): Array<{ key: DealStage['key']; short: string; present: boolean }> {
  return DEAL_STAGES.map((s) => ({ key: s.key, short: s.short, present: !!file[s.field] }));
}

/**
 * One row per stage in business order. A stage is "not yet" when the deal file has no entry for it, the entry is not
 * readable (RLS) or the entry belongs to a different form than the stage expects.
 */
export function buildTimeline(file: DealFileStages, entries: TimelineEntryRow[], forms: TimelineFormRow[]): TimelineStage[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const formById = new Map(forms.map((f) => [f.id, f]));
  return DEAL_STAGES.map((s) => {
    const id = file[s.field];
    const row = id ? byId.get(id) : undefined;
    const form = row ? formById.get(row.form_id) : undefined;
    if (!row || !form || form.slug !== s.slug) return { key: s.key, label: s.label, slug: s.slug, entry: null };
    return {
      key: s.key,
      label: s.label,
      slug: s.slug,
      entry: {
        id: row.id,
        number: row.number,
        status: row.status,
        summary: row.summary,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        formName: form.name,
        href: `/admin/forms/${encodeURIComponent(form.slug)}/entries/${row.number}`,
      },
    };
  });
}

/** Invoices in the deal file's own order (by invoice number), skipping ids the mirror no longer has. */
export function orderInvoices<T extends { invoice_id: string }>(invoiceIds: readonly string[], rows: readonly T[]): T[] {
  const byId = new Map(rows.map((r) => [r.invoice_id, r]));
  return [...new Set(invoiceIds)].map((id) => byId.get(id)).filter((r): r is T => !!r);
}

export const QUOTE_NO_PARAM = /^[A-Za-z0-9-]{1,40}$/;
export const UUID_PARAM = /^[0-9a-fA-F-]{36}$/;
