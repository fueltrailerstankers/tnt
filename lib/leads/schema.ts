import { z } from 'zod';

// Zod schemas for lead intake and the inbox. Pure.

export const LEAD_STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost', 'spam'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
/** Statuses re-matched against Xero by the rematch job. */
export const OPEN_STATUSES: readonly LeadStatus[] = ['new', 'contacted', 'quoted'];

/** Sources the intake endpoint accepts today. Manual leads come from the inbox UI. */
export const WEBHOOK_SOURCES = ['test', 'website'] as const;

const text = (max: number) => z.string().trim().max(max).optional().transform((s) => (s ? s : undefined));
const optEmail = z.string().trim().max(254).optional()
  .transform((s) => (s ? s : undefined))
  .pipe(z.email().optional());
/** Branch names: letter first, then letters, spaces, dots, apostrophes or hyphens (0023 lead_set_branch agrees). */
export const BRANCH_PATTERN = /^[A-Za-z][A-Za-z .'-]*$/;
const branch = z.string().trim().max(60).optional()
  .transform((s) => (s ? s : undefined))
  .pipe(z.string().regex(BRANCH_PATTERN).optional());

const contactFields = {
  name: text(160),
  email: optEmail,
  phone: text(40),
  product: text(300),
  message: text(4000),
  branch,
};

const hasContact = (v: { email?: string; phone?: string }) => Boolean(v.email || (v.phone && v.phone.replace(/\D/g, '').length >= 9));
const contactRequired = { message: 'An email or a phone number (at least 9 digits) is required', path: ['email'] };

/** Body of POST /api/webhooks/leads. */
export const IntakePayload = z.object({
  source: z.enum(WEBHOOK_SOURCES),
  source_id: z.string().trim().min(1).max(200),
  form: text(120),
  ...contactFields,
  gclid: text(300),
  fbclid: text(300),
  utm: z.record(z.string().regex(/^utm_[a-z_]{1,30}$/), z.string().max(300)).optional(),
}).refine(hasContact, contactRequired);
export type IntakePayload = z.infer<typeof IntakePayload>;

/** "New lead" form in the inbox. */
export const ManualLead = z.object(contactFields).refine(hasContact, contactRequired);
export type ManualLead = z.infer<typeof ManualLead>;

export const StatusChange = z.object({ id: z.guid(), status: z.enum(LEAD_STATUSES) });
export const Assign = z.object({ id: z.guid(), assigned_to: z.union([z.guid(), z.literal('').transform(() => null)]) });
export const Note = z.object({ id: z.guid(), body: z.string().trim().min(1).max(4000) });

/** Lead detail actions (0023 RPCs). `into` / `of` is the original the page showed; the RPC refuses if it changed. */
export const Merge = z.object({ id: z.guid(), into: z.guid() }).refine((v) => v.id !== v.into, { message: 'A lead cannot be merged into itself', path: ['into'] });
export const NotDuplicate = z.object({ id: z.guid(), of: z.guid() });
/** Branch change: blank clears the branch (null). */
export const BranchChange = z.object({
  id: z.guid(),
  branch: z.string().trim().max(60).transform((s) => (s ? s : null)).pipe(z.string().regex(BRANCH_PATTERN).nullable()),
});
