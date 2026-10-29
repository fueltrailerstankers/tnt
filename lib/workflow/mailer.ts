import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { appEnv } from '@/lib/env';
import type { BuiltEmail } from './email-template';

export interface Attachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendInput extends BuiltEmail {
  /** The entry the email belongs to; null for emails about something else (e.g. a lead). */
  entryId: string | null;
  /** Lead notifications (M4): email_log.lead_id; org_id is then taken from the lead. */
  leadId?: string;
  action: string;
  eventKey: string;
  attachments: Attachment[];
}

/** Resend allows 40 MB per message; stay under it with room for encoding overhead. */
export const MAX_ATTACHMENT_BYTES = 28 * 1024 * 1024;

export type SendStatus = 'sent' | 'failed' | 'skipped';

/**
 * Sends through Resend when RESEND_API_KEY is set; otherwise records the email as 'skipped' (log-only mode).
 * email_log keeps recipients and subject for the entry timeline, never the body or attachment names.
 */
export async function sendEmail(db: SupabaseClient, input: SendInput): Promise<SendStatus> {
  const env = appEnv();
  const from = env.MAIL_FROM ?? 'Trailers & Tankers <no-reply@example.invalid>';
  let status: SendStatus = 'skipped';
  let providerId: string | null = null;
  let error: string | null = null;

  if (!input.to.length) {
    status = 'skipped';
    error = 'no recipients';
  } else if (env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: input.to,
          reply_to: input.replyTo,
          subject: input.subject,
          html: input.html,
          text: input.text,
          attachments: input.attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64'), content_type: a.contentType })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string };
      if (res.ok) {
        status = 'sent';
        providerId = body.id ?? null;
      } else {
        status = 'failed';
        error = `resend ${res.status}${body.name ? ` ${body.name}` : ''}`;
      }
    } catch {
      status = 'failed';
      error = 'resend request failed';
    }
  } else {
    error = 'RESEND_API_KEY not set (log-only)';
  }

  await db.from('email_log').insert({
    entry_id: input.entryId,
    ...(input.leadId ? { lead_id: input.leadId } : {}),
    action: input.action,
    event_key: input.eventKey,
    to_addresses: input.to,
    from_address: from,
    subject: input.subject,
    provider_message_id: providerId,
    status,
    error,
  });
  return status;
}
