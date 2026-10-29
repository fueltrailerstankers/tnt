// delivery.update_invoice (BUILD_PLAN 4.3). Pure.
//
//   - find INV-{INVOICENO}; stop and retry later if it is not in Xero yet
//   - skip DELETED / VOIDED invoices
//   - set the invoice Reference to the VIN
//   - attach the delivery note PDF (document #1), signed ID, payment 1, payment 2, NATIS, then the first file of
//     each of the four photo fields
//   - re-attach the RFI PDF (the RFI is the Delivery Note's QuoteNo lookup, or the stored invoice mapping)
import { invoiceNoOf } from '../mappers';
import { attachRequest, fileSource } from './plan-rfi';
import { emptyPlan, text, type EntryIn, type FileIn, type InvoiceIn, type Plan, type PlannedRequest } from './types';

/** In Make's order. ASSUMPTION: one file per field (the first), as Make maps a single file per attach module. */
export const DELIVERY_FILE_FIELDS = ['COPYOfSignatoryID', 'PAYMENT', 'Payment2', 'NATIS', 'Pic1FRONT', 'PIC2LEFT', 'PIC3RIGHT', 'Pic4REAR'] as const;

export interface DeliveryInput {
  entry: EntryIn;
  files: FileIn[];
  documentName: string;
  /** Invoices found by number INV-{INVOICENO}. */
  invoices: InvoiceIn[];
  /** The RFI behind this delivery (lookup or stored mapping), with its document #1 name. */
  rfi: { entry: EntryIn; documentName: string } | null;
}

export function deliveryKey(invoiceNumber: string) {
  return `delivery.update_invoice:${invoiceNumber}`;
}

export function planDeliveryInvoice(input: DeliveryInput): Plan {
  const { entry } = input;
  const no = invoiceNoOf(text(entry.data.INVOICENO));
  if (!no) return emptyPlan('delivery.update_invoice', `delivery.update_invoice:entry-${entry.id}`, 'skip', 'Delivery Note has no invoice number');
  const number = `INV-${no}`;
  const key = deliveryKey(number);
  const invoice = input.invoices.find((i) => (i.invoice_number ?? '').toUpperCase() === number);
  if (!invoice) return emptyPlan('delivery.update_invoice', key, 'retry', 'invoice not found in Xero');
  const status = (invoice.status ?? '').toUpperCase();
  if (status === 'DELETED' || status === 'VOIDED') return emptyPlan('delivery.update_invoice', key, 'skip', `invoice is ${status}`);

  const requests: PlannedRequest[] = [];
  const vin = text(entry.data.TrailerVinNO);
  if (vin && (invoice.reference ?? '') !== vin) {
    requests.push({
      step: `invoice.reference.${vin.replace(/[^A-Za-z0-9]/g, '')}`,
      method: 'POST',
      path: `/Invoices/${invoice.invoice_id}`,
      body: { Invoices: [{ InvoiceID: invoice.invoice_id, Reference: vin }] },
      purpose: 'Write the VIN to the invoice Reference',
    });
  }
  requests.push(attachRequest(
    `attach.doc1.${entry.updatedAt}`, invoice.invoice_id, input.documentName,
    { kind: 'document', formSlug: 'delivery-note', entryId: entry.id, template: 1, name: input.documentName },
    'Attach the delivery note PDF',
  ));
  for (const field of DELIVERY_FILE_FIELDS) {
    const first = input.files.filter((f) => f.kind === 'file' && f.fieldKey === field).sort((a, b) => a.sortOrder - b.sortOrder)[0];
    if (first) requests.push(attachRequest(`attach.${first.id}`, invoice.invoice_id, first.fileName, fileSource(entry.id, first), `Attach ${field}`));
  }
  if (input.rfi) {
    requests.push(attachRequest(
      `attach.rfi.${input.rfi.entry.id}.${input.rfi.entry.updatedAt}`, invoice.invoice_id, input.rfi.documentName,
      { kind: 'document', formSlug: 'request-for-invoice', entryId: input.rfi.entry.id, template: 1, name: input.rfi.documentName },
      'Re-attach the RFI PDF',
    ));
  }
  return {
    action: 'delivery.update_invoice', idempotencyKey: key, status: 'ready', requests, effects: [],
    expected: { invoiceNumber: number, reference: vin ?? invoice.reference, attachments: requests.filter((r) => r.file).length, rfiPdf: !!input.rfi },
  };
}
