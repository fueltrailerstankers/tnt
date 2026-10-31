'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { stockMessageFor } from '@/lib/stock/errors';
import { manualResultMessage } from '@/lib/stock/invoice-review';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

// Invoice review actions (docs/M6.md section 5, admin only: stock.manage). requirePerm first, Zod, then:
// - manual apply: the caller's own client calls stock_apply_invoice in 'manual' mode (the RPC checks the admin role
//   again, matches the VIN, raises conflicts and writes the stock.reserve / stock.sell audit row);
// - resolve: stock_invoice_exceptions has no client write grant, so the service role updates the open exception of
//   the caller's org and an audit row records ids and the reason code (the note stays on the exception).

const PAGE = '/admin/stock/invoices';

export type InvoiceActionState = { ok?: string; error?: string; at?: number };

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : '';
};

const Manual = z.object({
  invoice_number: z.string().trim().min(1, 'Enter the invoice number.').max(50, 'The invoice number is too long.'),
  reference: z.string().trim().min(1, 'Enter the invoice reference (VIN).').max(500, 'The reference is too long.'),
  status: z.enum(['reserved', 'sold'], { message: 'Choose a payment status.' }),
});

/** Manual invoice update (plan 7.5) for an invoice not in Xero yet. Same rules as the job; audited by the RPC. */
export async function applyManualInvoice(_prev: InvoiceActionState, fd: FormData): Promise<InvoiceActionState> {
  const member = await requirePerm('stock.manage');
  const parsed = Manual.safeParse({ invoice_number: str(fd, 'invoice_number'), reference: str(fd, 'reference'), status: str(fd, 'status') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the values and try again.', at: Date.now() };
  const { invoice_number, reference, status } = parsed.data;
  const db = await createClient();
  const { data, error } = await db.rpc('stock_apply_invoice', {
    p_org: member.orgId, p_invoice_number: invoice_number, p_xero_invoice_id: null, p_reference: reference, p_outcome: status, p_mode: 'manual',
  });
  if (error) return { error: stockMessageFor(error), at: Date.now() };
  revalidatePath(PAGE);
  return { ok: manualResultMessage(data), at: Date.now() };
}

const Resolve = z.object({
  id: z.uuid(),
  note: z.string().trim().min(1, 'Enter a resolution note.').max(500, 'The note is too long (500 characters at most).'),
});

/** Resolves one open exception with a required note. Audited (ids and reason code only). */
export async function resolveException(_prev: InvoiceActionState, fd: FormData): Promise<InvoiceActionState> {
  const member = await requirePerm('stock.manage');
  const parsed = Resolve.safeParse({ id: str(fd, 'id'), note: str(fd, 'note') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Enter a resolution note.', at: Date.now() };
  const { id, note } = parsed.data;
  const db = createAdminClient();
  const { data, error } = await db.from('stock_invoice_exceptions')
    .update({ resolved_at: new Date().toISOString(), resolved_by: member.userId, resolution: note })
    .eq('org_id', member.orgId).eq('id', id).is('resolved_at', null)
    .select('id, reason, invoice_number, xero_invoice_id, unit_id');
  if (error) return { error: 'The exception could not be resolved. Try again.', at: Date.now() };
  const row = data?.[0] as { id: string; reason: string; invoice_number: string | null; xero_invoice_id: string | null; unit_id: string | null } | undefined;
  if (!row) return { error: 'This exception is already resolved or no longer exists.', at: Date.now() };
  await db.from('audit_log').insert({
    org_id: member.orgId, actor_user: member.userId, action: 'stock.exception_resolve', entity: 'stock_invoice_exception', entity_id: row.id,
    meta: Object.fromEntries(Object.entries({
      exception_id: row.id, reason: row.reason, invoice_number: row.invoice_number, xero_invoice_id: row.xero_invoice_id, unit_id: row.unit_id,
    }).filter(([, v]) => v !== null)),
  });
  revalidatePath(PAGE);
  return { ok: 'Exception resolved.', at: Date.now() };
}
