// "Things waiting on you": one task model for /admin/tasks, the Home "My tasks" card and the phone task cards. Pure.
//
// Categories and who sees them (a row only appears when the member can act on it):
//   inspections  Submitted -> Mark reviewed (entries.review), Reviewed -> Approve (entries.approve)
//   store-room   APPROVAL -> Mark APPROVED EMAILED, a manual status (entries.write)
//   failed-jobs  outbox jobs that gave up, and Xero sync entities with an error (integrations.manage)
//   leads        new leads assigned to the member (leads.read)
// Order: category, then oldest first.
import { minimumOf, shortBy } from '@/lib/spec/presentation';
import { inputFields, type FormSpec } from '@/lib/spec/types';
import { displayValue, type EntryData } from '@/lib/spec/values';
import { can, type Member } from '@/lib/security/can';
import { sastClock } from '@/lib/ui/time';
import { toneFor, type Tone } from '@/lib/ui/status';
import { ageLabel, plural, sinceLabel, whenLabel } from './format';
import { jobErrorLabel } from './jobs';

export const INSPECTION_SLUG = 'trailer-inspection-checklist';
export const STORE_ROOM_SLUG = 'store-room';
export const STORE_ROOM_TASK_STATUS = 'APPROVAL';
export const STORE_ROOM_DONE_STATUS = 'APPROVED EMAILED';
/** Inspection statuses that wait on staff, and the spec action each one's button runs. */
export const INSPECTION_ACTIONS = { Submitted: 'MarkReviewed', Reviewed: 'ApproveInspection' } as const;
export const XERO_PAGE = '/admin/integrations/xero';

export type TaskCategory = 'inspections' | 'store-room' | 'failed-jobs' | 'leads';
export type TaskFilter = 'all' | TaskCategory;
export type TaskIcon = 'inspect' | 'store' | 'warning' | 'leads';

export const TASK_FILTERS: ReadonlyArray<{ value: TaskFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'inspections', label: 'Inspections' },
  { value: 'store-room', label: 'Store Room' },
  { value: 'failed-jobs', label: 'Failed jobs' },
  { value: 'leads', label: 'Leads' },
];

const CATEGORY_ORDER: Record<TaskCategory, number> = { inspections: 0, 'store-room': 1, 'failed-jobs': 2, leads: 3 };

/** What the primary button of a row does. Entry transitions are server actions; the rest are existing actions or links. */
export type TaskPrimary =
  | { type: 'inspection'; action: 'review' | 'approve'; label: string; entryId: string; version: string; number: number }
  | { type: 'store-room'; label: string; number: number; status: string }
  | { type: 'sync-retry'; label: string }
  | { type: 'link'; label: string; href: string };

export interface TaskRow {
  /** Stable key, unique across categories. */
  id: string;
  testId: string;
  category: TaskCategory;
  icon: TaskIcon;
  tone: Tone;
  title: string;
  href: string;
  status: string;
  statusTone: Tone;
  meta: string;
  /** ISO time the task has waited since; the sort key. */
  sortAt: string;
  age: string;
  secondary: { label: string; href: string } | null;
  primary: TaskPrimary | null;
  /** Compact row on Home. */
  home: { kind: string; kindTone: Tone; title: string; meta: string; action: string; href: string };
  /** Card on the phone Home. */
  phone: { title: string; meta: string };
}

export interface TaskPerms {
  review: boolean;
  approve: boolean;
  storeRoom: boolean;
  jobs: boolean;
  leads: boolean;
}

export function taskPerms(member: Member | null): TaskPerms {
  return {
    review: can(member, 'entries.review'),
    approve: can(member, 'entries.approve'),
    storeRoom: can(member, 'entries.write'),
    jobs: can(member, 'integrations.manage'),
    leads: can(member, 'leads.read'),
  };
}

/** Filters the member can ever see ('all' first). Categories they can never act on are hidden. */
export function visibleFilters(p: TaskPerms): TaskFilter[] {
  const out: TaskFilter[] = ['all'];
  if (p.review || p.approve) out.push('inspections');
  if (p.storeRoom) out.push('store-room');
  if (p.jobs) out.push('failed-jobs');
  if (p.leads) out.push('leads');
  return out;
}

export function parseFilter(raw: string | string[] | null | undefined, visible: readonly TaskFilter[]): TaskFilter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (visible as readonly string[]).includes(v ?? '') ? (v as TaskFilter) : 'all';
}

export interface InspectionInput {
  id: string;
  number: number;
  status: string;
  /** entries.updated_at: the version the action must match. */
  version: string;
  data: EntryData;
  waitingSince: string;
  reviewedBy: string | null;
}

export interface StoreRoomInput {
  id: string;
  number: number;
  status: string;
  version: string;
  data: EntryData;
  waitingSince: string;
  countedBy: string | null;
}

export interface OutboxFailure {
  id: string;
  queue: string;
  attempts: number;
  lastError: string | null;
  failedAt: string;
}

export interface SyncFailure {
  entity: string;
  error: string;
  at: string;
  runId: number | null;
}

export interface LeadInput {
  id: string;
  name: string | null;
  status: string;
  createdAt: string;
  duplicateOf: string | null;
  duplicateName: string | null;
}

export interface BuildInput {
  inspections?: InspectionInput[];
  storeRoom?: StoreRoomInput[];
  /** Store Room spec, for the below-minimum count. */
  storeRoomSpec?: FormSpec | null;
  failedJobs?: OutboxFailure[];
  syncFailures?: SyncFailure[];
  leads?: LeadInput[];
  perms: TaskPerms;
  now: Date | string;
}

const entryHref = (slug: string, n: number) => `/admin/forms/${slug}/entries/${n}`;
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** VIN, inspector name and the number of checklist rows marked Fail. */
export function inspectionFacts(data: EntryData): { vin: string; inspector: string; fails: number } {
  const rows = Array.isArray(data.checklist) ? (data.checklist as Array<{ fail?: unknown }>) : [];
  return {
    vin: text(data.TRAILERVINNUMBER),
    inspector: displayValue(data.InspectedByName).trim(),
    fails: rows.filter((r) => r && r.fail === true).length,
  };
}

/** Store Room items whose label carries a minimum, and how many counted values are below it. */
export function storeRoomShortage(spec: FormSpec | null | undefined, data: EntryData): { short: number; total: number } {
  if (!spec) return { short: 0, total: 0 };
  let total = 0;
  let short = 0;
  for (const f of inputFields(spec)) {
    if (f.type !== 'text' && f.type !== 'number') continue;
    const min = minimumOf(f.label);
    if (min === null) continue;
    total += 1;
    const v = data[f.name];
    if (shortBy(typeof v === 'number' || typeof v === 'string' ? v : null, min) > 0) short += 1;
  }
  return { short, total };
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function buildTasks(input: BuildInput): TaskRow[] {
  const { perms, now } = input;
  const rows: TaskRow[] = [];

  for (const e of input.inspections ?? []) {
    const href = entryHref(INSPECTION_SLUG, e.number);
    const f = inspectionFacts(e.data);
    const title = f.vin ? `Inspection #${e.number} · ${f.vin}` : `Inspection #${e.number}`;
    const base = { category: 'inspections' as const, icon: 'inspect' as const, title, href, status: e.status, sortAt: e.waitingSince, age: ageLabel(e.waitingSince, now), secondary: { label: 'Open', href } };
    if (e.status === 'Submitted' && perms.review) {
      const tone = toneFor('Submitted');
      rows.push({
        ...base, id: `inspection:${e.id}`, testId: `task-inspection-${e.number}`, tone, statusTone: tone,
        meta: ['Needs review', f.inspector, f.fails ? `${plural(f.fails, 'row')} marked Fail` : ''].filter(Boolean).join(' · '),
        primary: { type: 'inspection', action: 'review', label: 'Mark reviewed', entryId: e.id, version: e.version, number: e.number },
        home: {
          kind: 'Review', kindTone: 'teal', title: `Review inspection #${e.number}`, action: 'Review', href,
          meta: [f.vin ? `VIN ${f.vin}` : '', `submitted ${sinceLabel(e.waitingSince, now)}${f.inspector ? ` by ${f.inspector}` : ''}`].filter(Boolean).join(' · '),
        },
        phone: { title: `Review inspection #${e.number}`, meta: [f.vin ? `VIN …${f.vin.slice(-4)}` : '', whenLabel(e.waitingSince, now)].filter(Boolean).join(' · ') },
      });
    } else if (e.status === 'Reviewed' && perms.approve) {
      const tone = toneFor('Reviewed');
      rows.push({
        ...base, id: `inspection:${e.id}`, testId: `task-inspection-${e.number}`, tone, statusTone: tone,
        meta: e.reviewedBy ? `Needs approval · reviewed by ${e.reviewedBy}` : 'Needs approval',
        primary: { type: 'inspection', action: 'approve', label: 'Approve', entryId: e.id, version: e.version, number: e.number },
        home: {
          kind: 'Approve', kindTone: 'yellow', title: `Approve inspection #${e.number}`, action: 'Open', href,
          meta: `Reviewed ${sinceLabel(e.waitingSince, now)}${e.reviewedBy ? ` by ${e.reviewedBy}` : ''}`,
        },
        phone: { title: `Approve inspection #${e.number}`, meta: whenLabel(e.waitingSince, now) },
      });
    }
  }

  if (perms.storeRoom) {
    for (const e of input.storeRoom ?? []) {
      if (e.status !== STORE_ROOM_TASK_STATUS) continue;
      const href = entryHref(STORE_ROOM_SLUG, e.number);
      const { short, total } = storeRoomShortage(input.storeRoomSpec, e.data);
      const tone = toneFor(STORE_ROOM_TASK_STATUS);
      rows.push({
        id: `store-room:${e.id}`, testId: `task-store-room-${e.number}`, category: 'store-room', icon: 'store', tone, statusTone: tone,
        title: `Store Room count #${e.number}`, href, status: e.status,
        meta: `${short} of ${total} items below minimum${e.countedBy ? ` · counted by ${e.countedBy}` : ''}`,
        sortAt: e.waitingSince, age: ageLabel(e.waitingSince, now), secondary: { label: 'Open', href },
        primary: { type: 'store-room', label: `Mark ${STORE_ROOM_DONE_STATUS}`, number: e.number, status: STORE_ROOM_DONE_STATUS },
        home: {
          kind: STORE_ROOM_TASK_STATUS, kindTone: 'red', title: `Store Room count #${e.number}`, action: 'Open', href,
          meta: short ? `${plural(short, 'item')} below minimum level` : 'No items below minimum',
        },
        phone: { title: `Store Room #${e.number}`, meta: short ? `${short} below minimum` : 'None below minimum' },
      });
    }
  }

  if (perms.jobs) {
    const jobsHref = '/admin/tasks?filter=failed-jobs';
    for (const j of input.failedJobs ?? []) {
      rows.push({
        id: `job:${j.id}`, testId: `task-job-${j.id}`, category: 'failed-jobs', icon: 'warning', tone: 'red', statusTone: 'red',
        title: j.queue, href: XERO_PAGE, status: 'Failed',
        meta: `${jobErrorLabel(j.lastError, 'long')} · ${plural(j.attempts, 'attempt')}`,
        sortAt: j.failedAt, age: ageLabel(j.failedAt, now), secondary: { label: 'Details', href: XERO_PAGE },
        // No server action re-queues an outbox job yet, so there is no Retry here (reported as a gap).
        primary: null,
        home: {
          kind: 'Failed', kindTone: 'red', title: `Job ${j.queue} failed`, action: 'Open', href: jobsHref,
          meta: `${jobErrorLabel(j.lastError, 'short')} · ${sastClock(j.failedAt)} · auto-retry exhausted`,
        },
        phone: { title: `Job ${j.queue} failed`, meta: jobErrorLabel(j.lastError, 'short') },
      });
    }
    for (const s of input.syncFailures ?? []) {
      const job = `xero.sync.${s.entity}`;
      rows.push({
        id: `sync:${s.entity}`, testId: `task-sync-${s.entity}`, category: 'failed-jobs', icon: 'warning', tone: 'red', statusTone: 'red',
        title: job, href: XERO_PAGE, status: 'Failed',
        meta: [jobErrorLabel(s.error, 'long'), s.runId ? `run #${s.runId}` : ''].filter(Boolean).join(' · '),
        sortAt: s.at, age: ageLabel(s.at, now), secondary: { label: 'Details', href: XERO_PAGE },
        primary: { type: 'sync-retry', label: 'Retry' },
        home: {
          kind: 'Failed', kindTone: 'red', title: `Job ${job} failed`, action: 'Retry', href: jobsHref,
          meta: `${jobErrorLabel(s.error, 'short')} · ${sastClock(s.at)}`,
        },
        phone: { title: `Job ${job} failed`, meta: jobErrorLabel(s.error, 'short') },
      });
    }
  }

  if (perms.leads) {
    for (const l of input.leads ?? []) {
      const href = `/admin/leads/${l.id}`;
      const name = l.name?.trim() || '(no name)';
      const dup = l.duplicateOf ? `possible duplicate of ${l.duplicateName?.trim() || 'another lead'}` : '';
      const status = capitalise(l.status);
      rows.push({
        id: `lead:${l.id}`, testId: `task-lead-${l.id}`, category: 'leads', icon: 'leads', tone: 'gray', statusTone: toneFor(status),
        title: `Lead · ${name}`, href, status,
        meta: ['Assigned to you', dup].filter(Boolean).join(' · '),
        sortAt: l.createdAt, age: ageLabel(l.createdAt, now), secondary: null,
        primary: { type: 'link', label: 'Open lead', href },
        home: {
          kind: 'Lead', kindTone: 'gray', title: `Lead ${name} assigned to you`, action: 'Open', href,
          meta: dup ? capitalise(dup) : `${status} lead · ${whenLabel(l.createdAt, now)}`,
        },
        phone: { title: `Lead · ${name}`, meta: 'Assigned to you' },
      });
    }
  }

  const statusRank = (r: TaskRow) => (r.category === 'inspections' && r.status === 'Reviewed' ? 1 : 0);
  return rows.sort((a, b) =>
    CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]
    || statusRank(a) - statusRank(b)
    || a.sortAt.localeCompare(b.sortAt)
    || a.id.localeCompare(b.id));
}

export type TaskCounts = Record<TaskFilter, number>;

export function taskCounts(rows: readonly Pick<TaskRow, 'category'>[]): TaskCounts {
  const c: TaskCounts = { all: rows.length, inspections: 0, 'store-room': 0, 'failed-jobs': 0, leads: 0 };
  for (const r of rows) c[r.category] += 1;
  return c;
}

export function filterRows<T extends Pick<TaskRow, 'category'>>(rows: readonly T[], filter: TaskFilter): T[] {
  return filter === 'all' ? [...rows] : rows.filter((r) => r.category === filter);
}

/** Empty-state copy for the list (all filters, or one). */
const EMPTY_BODY: Record<TaskFilter, string> = {
  all: 'Inspections and store-room counts that need review will appear here.',
  inspections: 'No inspections to review or approve.',
  'store-room': 'No Store Room counts waiting for approval.',
  'failed-jobs': 'No failed jobs.',
  leads: 'No new leads assigned to you.',
};

export function emptyCopy(filter: TaskFilter): { title: string; body: string } {
  return { title: 'Nothing needs you right now', body: EMPTY_BODY[filter] };
}

/** Result of a task action, shown inline above the list. */
export type TaskActionResult = { ok: true; message: string } | { ok: false; message: string; href?: string; linkLabel?: string };
