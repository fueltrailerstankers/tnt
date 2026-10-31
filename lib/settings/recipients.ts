// Settings > Notification recipients. Pure.
//
// notification_recipients (0004) says who is emailed for an event key: form workflow keys are "<form-slug>.<Action>"
// (e.g. request-for-invoice.Submit), others are "<area>.<event>" (release.paid, leads.new). Senders read the active
// rows for an event key. Branch is stored with the row for reference only: today every active recipient of an
// event is emailed, whatever the branch. Addresses are shown to Settings readers only and are never written to
// audit_log or logs (the audit row has the recipient id and event key).
import { z } from 'zod';

export const EVENT_KEY = /^[a-z][a-z0-9-]{0,40}(?:\.[A-Za-z0-9_-]{1,40}){1,3}$/;

const RecipientInput = z.object({
  id: z.uuid().optional().nullable(),
  eventKey: z.string().trim().regex(EVENT_KEY),
  address: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  branch: z.string().trim().max(60).optional().nullable(),
  active: z.boolean(),
});

export interface RecipientValue { id: string | null; eventKey: string; address: string; branch: string | null; active: boolean }
export type RecipientErrors = Partial<Record<'eventKey' | 'address' | 'branch' | 'form', string>>;

const MESSAGES = {
  eventKey: 'Use an event key like release.paid or request-for-invoice.Submit.',
  address: 'Enter one email address.',
  branch: 'Branch is up to 60 characters.',
} as const;

/** Validates the add/edit form. Messages are fixed texts (they never echo the input). */
export function parseRecipient(raw: Record<string, unknown>): { ok: true; value: RecipientValue } | { ok: false; errors: RecipientErrors } {
  const parsed = RecipientInput.safeParse(raw);
  if (!parsed.success) {
    const errors: RecipientErrors = {};
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0]);
      if (k === 'eventKey' || k === 'address' || k === 'branch') errors[k] ??= MESSAGES[k];
      else errors.form ??= 'Check the values and try again.';
    }
    return { ok: false, errors };
  }
  const d = parsed.data;
  return { ok: true, value: { id: d.id ?? null, eventKey: d.eventKey, address: d.address, branch: d.branch ? d.branch : null, active: d.active } };
}

export interface RecipientRow { id: string; event_key: string; address: string; branch: string | null; active: boolean }

/** Sorted by event key; within a key active rows first, then by address. */
export function sortRecipients<T extends RecipientRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.event_key.localeCompare(b.event_key) || Number(b.active) - Number(a.active) || a.address.localeCompare(b.address));
}

/** Event keys already in use, for the form's suggestions. */
export function knownEventKeys(rows: readonly Pick<RecipientRow, 'event_key'>[]): string[] {
  return [...new Set(rows.map((r) => r.event_key))].sort();
}

export const branchLabel = (b: string | null | undefined) => (b && b.trim() ? b : 'All branches');
