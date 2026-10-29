// invoice.merge_attachments (BUILD_PLAN 4.5). Pure. PLAN ONLY in this part.
//
// TODO(M3 part 2): merging needs pdf-lib, which is not installed. Do not add it here without approval. Until
// then this planner only lists what would be downloaded, merged, uploaded and removed, and the runner never
// sends anything for this action (modes.ts PLAN_ONLY).
//
// Rule kept from Make: upload the merged PDF first; never remove an original before that upload succeeded, and
// only when every original went into the merge. Originals are also kept in our own storage.
// Note: the Xero accounting API has no attachment delete, and our rules forbid deleting Xero records. The
// "remove" list is therefore informational: an open question for the owner (see docs/M3.md).
import { emptyPlan, safeFileName, type AttachmentIn, type InvoiceIn, type Plan } from './types';

export interface MergeInput {
  invoice: InvoiceIn;
  attachments: AttachmentIn[];
}

export interface MergeOutline {
  download: string[];
  mergedName: string;
  unsupported: string[];
  removeAfterUpload: string[];
}

export function mergedNameOf(invoiceNumber: string): string {
  return safeFileName(`${invoiceNumber.replace(/[\\/]/g, '-')}-merged.pdf`);
}

export function mergeKey(invoiceId: string) {
  return `invoice.merge_attachments:${invoiceId}`;
}

export function planMerge(input: MergeInput): Plan & { outline?: MergeOutline } {
  const key = mergeKey(input.invoice.invoice_id);
  const number = input.invoice.invoice_number ?? input.invoice.invoice_id;
  const mergedName = mergedNameOf(number);
  if (input.attachments.some((a) => a.file_name === mergedName)) return emptyPlan('invoice.merge_attachments', key, 'skip', 'already merged');
  if (input.attachments.length < 2) return emptyPlan('invoice.merge_attachments', key, 'skip', 'fewer than two attachments');
  const mergeable = input.attachments.filter((a) => /pdf|image\/(png|jpe?g)/i.test(a.mime_type ?? ''));
  const unsupported = input.attachments.filter((a) => !mergeable.includes(a)).map((a) => a.attachment_id);
  const outline: MergeOutline = {
    download: mergeable.map((a) => a.attachment_id),
    mergedName,
    unsupported,
    // Only when every original is merged; never before the upload succeeded.
    removeAfterUpload: unsupported.length ? [] : mergeable.map((a) => a.attachment_id),
  };
  return {
    action: 'invoice.merge_attachments', idempotencyKey: key, status: 'ready', effects: [],
    reason: 'plan only (pdf-lib not installed)',
    requests: [{
      step: `upload.${mergedName}`,
      method: 'PUT',
      path: `/Invoices/${input.invoice.invoice_id}/Attachments/${encodeURIComponent(mergedName)}`,
      purpose: `Upload the merged PDF of ${mergeable.length} attachments (then, and only then, the originals may go)`,
    }],
    expected: { mergedName, merged: mergeable.length, unsupported: unsupported.length, removeAfterUpload: outline.removeAfterUpload.length },
    outline,
  };
}
