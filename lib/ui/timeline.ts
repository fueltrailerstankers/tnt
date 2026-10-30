// Maps entry_events rows to Timeline items. Pure.
// The timeline shows who did what and the NAMES of changed fields. It never shows values: only diff.changed (an
// array of field keys) is read, and keys are turned into labels. Anything else in the diff is ignored.

import { toneFor } from './status';

export type TimelineTone = 'teal' | 'yellow' | 'green' | 'red' | 'neutral';

export interface TimelineItem {
  id: string;
  /** Display name, "System", or the actor's role. */
  who: string;
  /** "submitted the entry", "changed status Submitted → Reviewed"; empty when only fields changed. */
  what: string;
  /** Labels of changed fields. Names only, never values. */
  fields: string[];
  /** ISO timestamp (UTC). */
  at: string;
  tone: TimelineTone;
}

/** The entry_events columns the timeline needs. */
export interface EntryEventRow {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  actor_user: string | null;
  actor_role: string | null;
  diff: unknown;
  created_at: string;
}

/** Changed field keys from an entry_events diff, as labels. Non-string keys and every other diff property are dropped. */
export function changedFieldNames(diff: unknown, labels: Readonly<Record<string, string>> = {}): string[] {
  if (!diff || typeof diff !== 'object') return [];
  const changed = (diff as { changed?: unknown }).changed;
  if (!Array.isArray(changed)) return [];
  const out: string[] = [];
  for (const key of changed) {
    if (typeof key !== 'string' || !key) continue;
    const label = Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : key;
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

function toneOf(status: string | null): TimelineTone {
  if (!status) return 'neutral';
  const t = toneFor(status);
  return t === 'gray' ? 'neutral' : t;
}

function whoOf(row: EntryEventRow, names: Readonly<Record<string, string>>): string {
  if (row.actor_user && names[row.actor_user]) return names[row.actor_user];
  const role = (row.actor_role ?? '').trim();
  if (!role) return 'Someone';
  return role[0].toUpperCase() + role.slice(1);
}

function whatOf(row: EntryEventRow, hasFields: boolean): string {
  const from = row.from_status;
  const to = row.to_status;
  if (!from && to) return to === 'Submitted' ? 'submitted the entry' : `created the entry as ${to}`;
  if (from && to && from !== to) return `changed status ${from} → ${to}`;
  if (hasFields) return '';
  return (row.action ?? '').trim().toLowerCase() || 'updated the entry';
}

/**
 * One Timeline item per event. `names` maps user ids to display names (profiles.full_name); `labels` maps field
 * keys to the spec's labels.
 */
export function timelineItem(
  row: EntryEventRow,
  opts: { names?: Readonly<Record<string, string>>; labels?: Readonly<Record<string, string>> } = {},
): TimelineItem {
  const fields = changedFieldNames(row.diff, opts.labels);
  return {
    id: row.id,
    who: whoOf(row, opts.names ?? {}),
    what: whatOf(row, fields.length > 0),
    fields,
    at: row.created_at,
    tone: row.from_status !== row.to_status ? toneOf(row.to_status) : 'neutral',
  };
}

/** The sentence after the actor's name: "changed status Submitted → Reviewed · changed fields: VIN, Notes". */
export function timelineText(item: Pick<TimelineItem, 'what' | 'fields'>): string {
  const parts = [item.what];
  if (item.fields.length) parts.push(`changed fields: ${item.fields.join(', ')}`);
  return parts.filter(Boolean).join(' · ');
}
