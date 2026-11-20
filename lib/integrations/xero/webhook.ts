// Xero webhooks. Pure. Xero signs the raw body with HMAC-SHA256 using the app's webhook key and sends it,
// base64 encoded, in x-xero-signature. Valid deliveries must get 200 and invalid ones 401 (that is also how
// Xero's "intent to receive" check works). Events carry ids only; the record is fetched afterwards.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export function verifySignature(rawBody: string | Buffer, header: string | null, key: string): boolean {
  if (!header || !key) return false;
  const expected = createHmac('sha256', key).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(header, 'base64');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const XeroEventSchema = z.object({
  resourceUrl: z.string().optional(),
  resourceId: z.string(),
  eventDateUtc: z.string(),
  eventType: z.string(),
  eventCategory: z.string(),
  tenantId: z.string(),
  tenantType: z.string().optional(),
});
export type XeroEvent = z.infer<typeof XeroEventSchema>;

export const Payload = z.object({
  events: z.array(XeroEventSchema),
  firstEventSequence: z.number().optional(),
  lastEventSequence: z.number().optional(),
  entropy: z.string().optional(),
});

/** Idempotency key for one event: the same delivery replayed maps to the same key. */
export function eventKey(e: XeroEvent): string {
  return createHash('sha256').update([e.tenantId, e.eventCategory, e.eventType, e.resourceId, e.eventDateUtc].join('|')).digest('hex');
}

/** Which mirror entity an event refreshes. Unknown categories are stored and ignored. */
export function entityFor(e: XeroEvent): 'invoices' | 'contacts' | null {
  if (e.eventCategory === 'INVOICE') return 'invoices';
  if (e.eventCategory === 'CONTACT') return 'contacts';
  return null;
}
