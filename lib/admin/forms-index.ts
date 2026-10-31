// Forms index cards (UI handoff FormsIndex.dc.html): access type, encrypted badge, counts, task flag, links. Pure.
import type { IconName } from '@/components/ui/Icon';
import { formUi, newEntryHref } from '@/lib/home/forms';
import type { Member } from '@/lib/security/can';
import type { FormSpec } from '@/lib/spec/types';
import { toneFor, type Tone } from '@/lib/ui/status';
import { statusColor, taskStatuses } from '@/lib/workflow/rules';

export interface IndexForm {
  slug: string;
  spec: FormSpec;
  isActive: boolean;
  encrypt: boolean;
}

export interface FormCardModel {
  slug: string;
  label: string;
  icon: IconName;
  href: string;
  /** "Public link", "Inspector link" (the public role's name) or "Internal". */
  access: string;
  encrypted: boolean;
  /** Release Form entries are normally created by the Xero paid-invoice action (business rule 3). */
  autoFromXero: boolean;
  entries: number;
  unread: number;
  /** Entries waiting on staff ("3 awaiting approval", "1 APPROVAL"). */
  flag: { label: string; tone: Tone } | null;
  newHref: string | null;
  /** /f/<slug> while the public link is on. */
  publicPath: string | null;
}

/** The public role's name, or null when the spec has none (a draft from the builder). */
function publicRoleName(spec: FormSpec): string | null {
  return spec.workflow.roles.find((r) => r.public)?.name ?? null;
}

export function accessLabel(form: Pick<IndexForm, 'spec' | 'isActive'>): string {
  if (!form.isActive) return 'Internal';
  const role = publicRoleName(form.spec);
  return !role || role === 'Public' ? 'Public link' : `${role} link`;
}

/** Statuses that wait on staff (the Tasks rule); none for a spec without an internal role. */
export function awaitingStatuses(spec: FormSpec): string[] {
  try {
    return taskStatuses(spec);
  } catch {
    return [];
  }
}

/**
 * Task flag: entries in statuses that wait on staff. One red status (Store Room APPROVAL) is named as is; anything
 * else reads "n awaiting approval".
 */
export function taskFlag(spec: FormSpec, awaiting: number): FormCardModel['flag'] {
  const statuses = awaitingStatuses(spec);
  if (!statuses.length || awaiting < 1) return null;
  if (statuses.length === 1 && toneFor(statuses[0], statusColor(spec, statuses[0])) === 'red') return { label: `${awaiting} ${statuses[0]}`, tone: 'red' };
  return { label: `${awaiting} awaiting approval`, tone: 'yellow' };
}

/** Where New entry goes (staff form, else the public link); null when neither applies or the spec has no roles. */
export function safeNewHref(form: IndexForm, member: Member | null): string | null {
  try {
    return newEntryHref(form, member);
  } catch {
    return null;
  }
}

export function formCard(form: IndexForm, counts: { entries: number; unread: number; awaiting: number }, member: Member | null): FormCardModel {
  const ui = formUi(form.slug, form.spec.name);
  return {
    slug: form.slug,
    label: ui.label,
    icon: ui.icon,
    href: `/admin/forms/${form.slug}`,
    access: accessLabel(form),
    encrypted: form.encrypt,
    autoFromXero: form.slug === 'release-form',
    entries: counts.entries,
    unread: counts.unread,
    flag: taskFlag(form.spec, counts.awaiting),
    newHref: safeNewHref(form, member),
    publicPath: form.isActive ? `/f/${form.slug}` : null,
  };
}

const n = new Intl.NumberFormat('en-US');

/** "7 forms · 2,585 entries · 12 unread". */
export function formsSummary(cards: ReadonlyArray<Pick<FormCardModel, 'entries' | 'unread'>>): string {
  const entries = cards.reduce((a, c) => a + c.entries, 0);
  const unread = cards.reduce((a, c) => a + c.unread, 0);
  return `${n.format(cards.length)} form${cards.length === 1 ? '' : 's'} · ${n.format(entries)} entr${entries === 1 ? 'y' : 'ies'} · ${n.format(unread)} unread`;
}

export function formatCount(v: number): string {
  return n.format(v);
}

/** Absolute public link for the copy box. */
export function publicUrl(appUrl: string, path: string): string {
  return `${appUrl.replace(/\/+$/, '')}${path}`;
}
