// How Home names and orders the seven forms, where "New" goes, and the reference shown per entry. Pure.
// Database names stay as Cognito had them ('RELEASE FORM', 'Delivery Note , Terms and Conditions'); these are
// display labels only. Field names are never renamed.
import type { IconName } from '@/components/ui/Icon';
import { can, type Member } from '@/lib/security/can';
import type { FormSpec } from '@/lib/spec/types';
import type { EntryData } from '@/lib/spec/values';
import { actionPermission, allowedActions, internalRole, NEW_ENTRY_STATUS } from '@/lib/workflow/rules';

export interface FormUi {
  label: string;
  /** Shorter label for the phone "New entry" tiles. */
  phoneLabel: string;
  icon: IconName;
  order: number;
}

export const FORM_UI: Readonly<Record<string, FormUi>> = {
  deal: { label: 'Deal', phoneLabel: 'Deal', icon: 'deals', order: 0 },
  'request-for-invoice': { label: 'Request for Invoice', phoneLabel: 'Invoice request', icon: 'invoices', order: 1 },
  'job-card': { label: 'Job Card', phoneLabel: 'Job Card', icon: 'job', order: 2 },
  'trailer-inspection-checklist': { label: 'Trailer Inspection', phoneLabel: 'Inspection', icon: 'inspect', order: 3 },
  'release-form': { label: 'Release Form', phoneLabel: 'Release', icon: 'release', order: 4 },
  'delivery-note': { label: 'Delivery Note + T&Cs', phoneLabel: 'Delivery', icon: 'delivery', order: 5 },
  'store-room': { label: 'Store Room', phoneLabel: 'Store Room', icon: 'store', order: 6 },
};

/** Forms on the phone "New entry" grid, in design order. */
export const PHONE_NEW_ENTRY = ['trailer-inspection-checklist', 'store-room', 'job-card', 'delivery-note'] as const;

export function formUi(slug: string, fallbackName: string): FormUi {
  return FORM_UI[slug] ?? { label: fallbackName, phoneLabel: fallbackName, icon: 'forms', order: 99 };
}

/** Design order (Deal first, Store Room last); unknown forms after, by name. */
export function sortForHome<T extends { slug: string; name: string }>(forms: readonly T[]): T[] {
  return [...forms].sort((a, b) => formUi(a.slug, a.name).order - formUi(b.slug, b.name).order || a.name.localeCompare(b.name));
}

/**
 * Where "New {form} entry" goes: the staff form when the member may write entries and the internal role has a
 * first action they are allowed to run; else the public link while the form is active; else nowhere.
 */
export function newEntryHref(form: { slug: string; spec: FormSpec; isActive: boolean }, member: Member | null): string | null {
  const staff = can(member, 'entries.write')
    && allowedActions(form.spec, NEW_ENTRY_STATUS, internalRole(form.spec).name).some((a) => can(member, actionPermission(a)));
  if (staff) return `/admin/forms/${form.slug}/new`;
  if (form.isActive) return `/f/${form.slug}`;
  return null;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Reference column on Home. Encrypted forms (deal, delivery-note) only ever use the clear summary. Forms whose
 * summary is a person's name (request-for-invoice, trailer-inspection-checklist) use a document number instead.
 * Store Room has no reference field.
 */
export function entryReference(slug: string, summary: string | null, data: EntryData | null | undefined): string {
  const d = data ?? {};
  switch (slug) {
    case 'deal':
    case 'delivery-note':
    case 'job-card':
      return str(summary) ?? '—';
    case 'release-form':
      return str(d.INVNO) ?? str(summary) ?? '—';
    case 'request-for-invoice':
      return str(d.QuoteNo) ?? '—';
    case 'trailer-inspection-checklist':
      return str(d.TRAILERVINNUMBER) ?? '—';
    default:
      return '—';
  }
}
