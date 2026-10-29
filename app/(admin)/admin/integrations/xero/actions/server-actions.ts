'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { loadConnection } from '@/lib/integrations/xero/connection';
import { invoiceNoOf } from '@/lib/integrations/xero/mappers';
import { checkSwitch, MODES, parseMode, settingKey } from '@/lib/integrations/xero/write/modes';
import { ACTIONS, queueOf } from '@/lib/integrations/xero/write/types';
import { enqueue } from '@/lib/jobs/outbox';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';

const PAGE = '/admin/integrations/xero/actions';

export type SwitchState = { ok?: string; error?: string };

const SwitchInput = z.object({
  action: z.enum(ACTIONS),
  mode: z.enum(MODES),
  confirm: z.string().max(80).optional().nullable(),
});

/** Changes an action's mode. Live needs xero.actions.configure, write scopes and the typed action name. Audited. */
export async function setActionMode(_prev: SwitchState, fd: FormData): Promise<SwitchState> {
  const member = await requirePerm('xero.actions.configure');
  const parsed = SwitchInput.safeParse({ action: fd.get('action'), mode: fd.get('mode'), confirm: fd.get('confirm') });
  if (!parsed.success) return { error: 'Choose an action and a mode.' };
  const { action, mode, confirm } = parsed.data;
  const db = createAdminClient();
  const conn = await loadConnection(db, member.orgId);
  const err = checkSwitch({ action, to: mode, mayConfigure: can(member, 'xero.actions.configure'), connection: conn, typed: confirm });
  if (err) return { error: err };

  const key = settingKey(action);
  const { data: cur } = await db.from('app_settings').select('value').eq('org_id', member.orgId).eq('key', key).maybeSingle();
  const from = parseMode(cur?.value);
  if (from === mode) return { ok: `${action} is already ${mode}.` };
  const { error } = await db.from('app_settings').upsert(
    { org_id: member.orgId, key, value: mode, updated_by: member.userId, updated_at: new Date().toISOString() },
    { onConflict: 'org_id,key' },
  );
  if (error) return { error: 'The setting could not be saved.' };
  await db.from('audit_log').insert({
    org_id: member.orgId, actor_user: member.userId, action: mode === 'live' ? 'xero.action.live' : 'xero.action.mode',
    entity: 'xero_action', entity_id: action, meta: { from, to: mode, confirmed: mode === 'live' },
  });
  revalidatePath(PAGE);
  return { ok: `${action}: ${from} -> ${mode}.` };
}

/** Plans (never performs) the attachment merge for one invoice. */
export async function planMergeFor(_prev: SwitchState, fd: FormData): Promise<SwitchState> {
  const member = await requirePerm('xero.actions.configure');
  const no = invoiceNoOf(String(fd.get('invoice') ?? '').slice(0, 40));
  if (!no || !/^[A-Z0-9-]+$/.test(no)) return { error: 'Enter an invoice number.' };
  const db = createAdminClient();
  const { data } = await db.from('xero_invoices').select('invoice_id').eq('org_id', member.orgId).eq('invoice_number', `INV-${no}`).maybeSingle();
  if (!data) return { error: 'Invoice not found in the mirror.' };
  await enqueue(db, member.orgId, queueOf('invoice.merge_attachments'), { invoiceId: data.invoice_id });
  await db.from('audit_log').insert({ org_id: member.orgId, actor_user: member.userId, action: 'xero.action.merge_plan', entity: 'xero_invoice', entity_id: data.invoice_id });
  revalidatePath(PAGE);
  return { ok: 'Merge plan queued. It appears below after the next job run.' };
}
