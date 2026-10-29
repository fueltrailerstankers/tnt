import 'server-only';
import { recordRun, type Handler } from '@/lib/jobs/outbox';
import { performXeroAction, type ActionPayload } from './run';
import { ACTIONS, queueOf } from './types';

/** Outbox handlers, one queue per action ("xero.<action>"). Each run is a job_runs row and a xero_action_runs row. */
export const XERO_ACTION_HANDLERS: Record<string, Handler> = Object.fromEntries(
  ACTIONS.map((action) => [
    queueOf(action),
    (async (db, job) => {
      if (!job.org_id) throw new Error('job has no org');
      const orgId = job.org_id;
      const p = job.payload as ActionPayload;
      await recordRun(db, orgId, queueOf(action), async () => {
        const status = await performXeroAction(db, orgId, action, { entryId: p.entryId, invoiceId: p.invoiceId });
        return { ok: status !== 'failed', processed: 1, error: status === 'failed' ? 'action failed' : undefined, result: status };
      });
    }) satisfies Handler,
  ]),
);
