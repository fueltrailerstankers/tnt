// Deal file journey: Deal -> Request for Invoice -> Inspection -> Release -> Delivery, one step per form. Pure.
// Reads entry metadata and timeline events only (status, times, who). Entry data, encrypted or not, is never needed.
import type { DealFileStages, StageField, TimelineStage } from '@/lib/deal-files/timeline';
import type { Tone } from '@/lib/ui/status';

/** System actor of jobs (release.on_paid): lib/workflow/run-action.ts SYSTEM_ROLE. */
const SYSTEM_ROLE = 'System';
const IMPORT_ROLE = 'Import';

export interface JourneyDef {
  key: 'deal' | 'rfi' | 'inspection' | 'release' | 'delivery';
  label: string;
  field: StageField;
  /** What the step waits for when it is the next one. */
  waiting: string;
}

export const JOURNEY: readonly JourneyDef[] = [
  { key: 'deal', label: 'Deal', field: 'deal_entry_id', waiting: 'In progress' },
  { key: 'rfi', label: 'Request for Invoice', field: 'rfi_entry_id', waiting: 'Awaiting customer' },
  { key: 'inspection', label: 'Inspection', field: 'inspection_entry_id', waiting: 'Awaiting inspection' },
  { key: 'release', label: 'Release', field: 'release_entry_id', waiting: 'Awaiting release' },
  { key: 'delivery', label: 'Delivery', field: 'delivery_entry_id', waiting: 'Awaiting delivery note' },
];

/** The entry_events columns used here. */
export interface JourneyEventRow {
  id: number | string;
  entry_id: string;
  actor_user: string | null;
  actor_role: string | null;
  from_status: string | null;
  to_status: string | null;
  created_at: string;
}

export interface StepActivity {
  /** When the entry reached its current status (ISO, UTC). */
  at: string;
  /** Who did it: a staff name, "Auto · Xero", "Cognito import", "Inspector link" or "Public link". */
  who: string;
  /** Created by a job (Release Form auto-created when the Xero invoice is paid). */
  auto: boolean;
}

function whoOf(e: JourneyEventRow, slug: string, names: ReadonlyMap<string, string>): string {
  if (e.actor_user) return names.get(e.actor_user) ?? 'Staff member';
  if (e.actor_role === SYSTEM_ROLE) return 'Auto · Xero';
  if (e.actor_role === IMPORT_ROLE) return 'Cognito import';
  return slug === 'trailer-inspection-checklist' ? 'Inspector link' : 'Public link';
}

const order = (a: JourneyEventRow, b: JourneyEventRow) =>
  a.created_at === b.created_at ? Number(a.id) - Number(b.id) : a.created_at < b.created_at ? -1 : 1;

/**
 * Per entry: the latest status change (else the latest event) gives when and who; the first event says whether a
 * job created it. `slugOf` maps entry id to its form slug (for the anonymous "who").
 */
export function stepActivity(
  events: readonly JourneyEventRow[],
  slugOf: ReadonlyMap<string, string>,
  names: ReadonlyMap<string, string>,
): Map<string, StepActivity> {
  const byEntry = new Map<string, JourneyEventRow[]>();
  for (const e of events) {
    const list = byEntry.get(e.entry_id) ?? [];
    list.push(e);
    byEntry.set(e.entry_id, list);
  }
  const out = new Map<string, StepActivity>();
  for (const [id, list] of byEntry) {
    const sorted = [...list].sort(order);
    const changes = sorted.filter((e) => e.to_status && e.to_status !== e.from_status);
    const last = changes[changes.length - 1] ?? sorted[sorted.length - 1];
    out.set(id, { at: last.created_at, who: whoOf(last, slugOf.get(id) ?? '', names), auto: sorted[0].actor_role === SYSTEM_ROLE });
  }
  return out;
}

export type StepState = 'done' | 'current' | 'todo';

export interface JourneyStep {
  key: JourneyDef['key'];
  label: string;
  state: StepState;
  /** Chip label: the entry's status, what the next step waits for, "Not started", or "Linked" without entry access. */
  status: string;
  /** Chip tone. */
  tone: Tone;
  at: string | null;
  who: string | null;
  /** Entry page; null without an entry or without access to entries. */
  href: string | null;
  /** "Open Deal #512". */
  linkLabel: string | null;
  /** Release Form created by the paid-invoice job. */
  auto: boolean;
}

export interface JourneyInput {
  /** Which stages the deal file links (always known). */
  file: DealFileStages;
  /** buildTimeline() output, or null when the member may not read form entries (then only presence is shown). */
  stages: readonly TimelineStage[] | null;
  activity: ReadonlyMap<string, StepActivity>;
  /** A sales invoice exists and none is fully paid: the Release step waits for payment. */
  awaitingPayment?: boolean;
}

export interface Journey {
  steps: JourneyStep[];
  /** Header chip: "Delivered", or "At <next step>". */
  headline: { label: string; tone: Tone };
  /** Job Card is linked to the deal file but is not a journey step. */
  jobCard: { href: string | null; label: string } | null;
}

/** An entry counts as done once it is past Incomplete (submitted or later). */
const isDone = (status: string) => status !== 'Incomplete';

export function buildJourney({ file, stages, activity, awaitingPayment = false }: JourneyInput): Journey {
  const byKey = new Map((stages ?? []).map((s) => [s.key, s]));
  const raw = JOURNEY.map((def) => {
    const entry = stages ? byKey.get(def.key)?.entry ?? null : null;
    const linked = !!file[def.field];
    const done = stages ? !!entry && isDone(entry.status) : linked;
    return { def, entry, linked, done };
  });
  let lastDone = -1;
  raw.forEach((r, i) => { if (r.done) lastDone = i; });
  const next = lastDone + 1;

  const steps: JourneyStep[] = raw.map(({ def, entry, linked, done }, i) => {
    const act = entry ? activity.get(entry.id) : undefined;
    const base = {
      key: def.key,
      label: def.label,
      at: entry ? act?.at ?? entry.updatedAt : null,
      who: act?.who ?? null,
      href: entry?.href ?? null,
      linkLabel: entry ? `Open ${entry.formName} #${entry.number}` : null,
      auto: !!act?.auto && def.key === 'release',
    };
    if (!stages) {
      return { ...base, state: done ? 'done' : i === next ? 'current' : 'todo', status: linked ? 'Linked' : 'Not linked', tone: linked ? 'green' : 'gray' };
    }
    if (done && entry) return { ...base, state: 'done', status: entry.status, tone: 'green' };
    if (entry) return { ...base, state: 'current', status: entry.status, tone: 'yellow' };
    if (i === next) {
      const waiting = def.key === 'release' && awaitingPayment ? 'Waiting for payment' : def.waiting;
      return { ...base, state: 'current', status: waiting, tone: 'yellow' };
    }
    return { ...base, state: 'todo', status: i < lastDone ? 'Not linked' : 'Not started', tone: 'gray' };
  });

  const delivered = steps[steps.length - 1].state === 'done';
  const current = steps.find((s) => s.state === 'current');
  const headline: Journey['headline'] = delivered
    ? { label: 'Delivered', tone: 'green' }
    : { label: `At ${current?.label ?? steps[0].label}`, tone: 'yellow' };

  const job = stages ? byKey.get('job')?.entry ?? null : null;
  const jobCard = job
    ? { href: job.href, label: `${job.formName} #${job.number}` }
    : file.job_card_entry_id ? { href: null, label: 'Job Card' } : null;
  return { steps, headline, jobCard };
}
