// Protected fields on the entry page (handoff: masked for non-admins, reveal is audited). Pure.
// The clear value of a protected field never reaches the page: the form gets the entry without it (the field is
// hidden in the form), the rail shows a server-made mask, and only the audited reveal action returns the value.
// A save from the entry page keeps the stored value, whatever is posted for the field.
import { z } from 'zod';
import type { Member } from '@/lib/security/can';
import { can } from '@/lib/security/can';
import type { FormSpec, InputField } from '@/lib/spec/types';
import { inputFields } from '@/lib/spec/types';
import type { EntryData } from '@/lib/spec/values';
import { maskEmail } from '@/lib/ui/mask';

/** Never a real field name: a show-when rule on it is always false, so the field is hidden. */
const NEVER = '__protected_hidden';

export function protectedFields(spec: FormSpec): InputField[] {
  return inputFields(spec).filter((f) => f.type === 'email' && f.protected === true);
}

export function protectedNames(spec: FormSpec): string[] {
  return protectedFields(spec).map((f) => f.name);
}

/** Only admins may reveal a protected value (the grid and exports use the same rule). */
export function canReveal(member: Member | null | undefined): boolean {
  return !!member && member.role === 'admin' && can(member, 'entries.read');
}

/**
 * The spec the page's form renders: protected fields stay in the spec (same layout, names and order) but carry a
 * show-when rule that is never true, so the form neither shows nor checks them. The server saves with the real spec.
 */
export function formSpecForPage(spec: FormSpec): FormSpec {
  const names = new Set(protectedNames(spec));
  if (!names.size) return spec;
  return {
    ...spec,
    fields: spec.fields.map((f) => ('name' in f && names.has(f.name) && f.type === 'email' ? { ...f, showWhen: `${NEVER} is not empty` } : f)),
  };
}

/** Entry data for the page's form: protected values removed. */
export function withoutProtected(spec: FormSpec, data: EntryData): EntryData {
  const names = protectedNames(spec);
  if (!names.length) return data;
  const out: EntryData = { ...data };
  for (const n of names) delete out[n];
  return out;
}

export interface ProtectedView {
  name: string;
  label: string;
  /** Masked on the server; empty when there is no value. */
  masked: string;
  hasValue: boolean;
}

export function protectedView(spec: FormSpec, data: EntryData): ProtectedView[] {
  return protectedFields(spec).map((f) => {
    const v = typeof data[f.name] === 'string' ? (data[f.name] as string) : '';
    return { name: f.name, label: ('label' in f && f.label.trim()) || f.name, masked: maskEmail(v), hasValue: v.trim() !== '' };
  });
}

/** Minimal FormData surface (so the rule is testable without a request). */
export interface FormDataLike {
  delete(name: string): void;
  set(name: string, value: string): void;
}

/** Before a save from the entry page: whatever was posted, protected fields keep what the entry has stored. */
export function keepStoredProtected(spec: FormSpec, fd: FormDataLike, stored: EntryData | null): void {
  for (const n of protectedNames(spec)) {
    fd.delete(`f.${n}`);
    const v = stored?.[n];
    if (typeof v === 'string') fd.set(`f.${n}`, v);
  }
}

/** Email recipients equal to a protected value of this entry are masked in the "Emails sent" card. */
export function maskRecipients(spec: FormSpec, data: EntryData, recipients: readonly string[]): string[] {
  const secret = new Set(
    protectedNames(spec)
      .map((n) => data[n])
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .map((v) => v.trim().toLowerCase()),
  );
  return recipients.map((r) => (secret.has(String(r).trim().toLowerCase()) ? maskEmail(String(r)) : String(r)));
}

/** Input of the reveal action. */
export const RevealInput = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  number: z.number().int().positive(),
  field: z.string().min(1).max(120),
});

/** The audit row for a reveal: ids and field keys only, never the value. */
export function revealAuditRow(member: Pick<Member, 'orgId' | 'userId'>, entryId: string, slug: string, fields: string[]) {
  return { org_id: member.orgId, actor_user: member.userId, action: 'entry.reveal', entity: 'entry', entity_id: entryId, meta: { form: slug, fields } };
}

/** The audit row written when an encrypted entry is opened (decrypted for the viewer): ids only. */
export function decryptAuditRow(member: Pick<Member, 'orgId' | 'userId'>, entryId: string, slug: string, number: number, via: 'page' | 'document' = 'page') {
  return { org_id: member.orgId, actor_user: member.userId, action: 'entry.decrypt', entity: 'entry', entity_id: entryId, meta: { form: slug, number, via } };
}
