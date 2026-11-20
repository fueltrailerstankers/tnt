'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition, type FormEvent } from 'react';
import { addLeadNote, markNotDuplicate, mergeLead, setLeadAssignee, setLeadBranch, setLeadStatus } from '@/app/(admin)/admin/leads/actions';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea } from '@/components/ui/Field';
import { actionMessage, type ActionResult } from '@/lib/leads-view/actions';
import { BOARD_STAGES, STATUS_LABEL } from '@/lib/leads-view/model';
import { LEAD_STATUSES } from '@/lib/leads/schema';

// Lead write controls. Each calls a permission-checked server action (requirePerm('leads.manage') + Zod), then
// refreshes the server-rendered page. Outcome text is announced in a polite live region (errors as alerts).

type Outcome = { kind: 'ok' | 'error'; text: string } | null;

function useSave() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const run = (fn: () => Promise<ActionResult>, ok: string, after?: () => void) => {
    setOutcome(null);
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setOutcome({ kind: 'ok', text: ok });
        after?.();
        router.refresh();
      } else setOutcome({ kind: 'error', text: actionMessage(r.error) });
    });
  };
  return { pending, outcome, run };
}

function OutcomeText({ outcome, id }: { outcome: Outcome; id?: string }) {
  return (
    <p id={id} role={outcome?.kind === 'error' ? 'alert' : 'status'} className={`m-0 min-h-4 text-[12px] leading-4 ${outcome?.kind === 'error' ? 'text-status-red-fg' : 'text-fg-muted'}`}>
      {outcome?.text ?? ''}
    </p>
  );
}

export function StatusForm({ id, status }: { id: string; status: string }) {
  const field = useId();
  const [value, setValue] = useState(status);
  const { pending, outcome, run } = useSave();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(() => setLeadStatus({ id, status: value }), `Status set to ${STATUS_LABEL[value as keyof typeof STATUS_LABEL] ?? value}.`);
  };
  return (
    <form onSubmit={submit} className="flex flex-col">
      <Label htmlFor={field}>Status</Label>
      <div className="flex gap-2">
        <Select id={field} name="status" value={value} onChange={(e) => setValue(e.target.value)} className="h-11 py-0 lg:h-[38px]">
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
        <Button type="submit" variant="secondary" size={38} className="max-lg:h-11" loading={pending} disabled={value === status}>Set status</Button>
      </div>
      <OutcomeText outcome={outcome} />
    </form>
  );
}

export function AssignForm({ id, assigned, members }: { id: string; assigned: string | null; members: ReadonlyArray<{ userId: string; label: string }> }) {
  const field = useId();
  const [value, setValue] = useState(assigned ?? '');
  const { pending, outcome, run } = useSave();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(() => setLeadAssignee({ id, assigned_to: value }), value ? 'Lead assigned.' : 'Lead unassigned.');
  };
  return (
    <form onSubmit={submit} className="flex flex-col">
      <Label htmlFor={field}>Assign to</Label>
      <div className="flex gap-2">
        <Select id={field} name="assigned_to" value={value} onChange={(e) => setValue(e.target.value)} className="h-11 py-0 lg:h-[38px]">
          <option value="">Unassigned</option>
          {members.map((m) => <option key={m.userId} value={m.userId}>{m.label}</option>)}
        </Select>
        <Button type="submit" variant="secondary" size={38} className="max-lg:h-11" loading={pending} disabled={value === (assigned ?? '')}>Assign</Button>
      </div>
      <OutcomeText outcome={outcome} />
    </form>
  );
}

/**
 * Stage pills (pipeline drawer, phone detail): one button per board stage with aria-pressed; a press saves at once.
 * A lead marked Spam shows no pressed stage until one is chosen.
 */
export function StagePills({ id, status, size = 34, onSaved }: { id: string; status: string; size?: 34 | 44; onSaved?: (status: string) => void }) {
  const { pending, outcome, run } = useSave();
  const [target, setTarget] = useState<string | null>(null);
  const label = useId();
  const pick = (s: string) => {
    if (s === status || pending) return;
    setTarget(s);
    run(() => setLeadStatus({ id, status: s }), `Moved to ${STATUS_LABEL[s as keyof typeof STATUS_LABEL]}.`, () => onSaved?.(s));
  };
  return (
    <div className="flex flex-col gap-2">
      <span id={label} className="text-small font-semibold">Stage</span>
      <div role="group" aria-labelledby={label} className="flex flex-wrap gap-1.5">
        {BOARD_STAGES.map((s) => {
          const on = (pending ? target : status) === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              disabled={pending && target !== s}
              aria-busy={pending && target === s ? true : undefined}
              onClick={() => pick(s)}
              className={`inline-flex items-center gap-1.5 rounded-pill border px-3 font-semibold disabled:opacity-60 ${size === 44 ? 'h-11 px-3.5 text-body' : 'h-[34px] text-small'} ${on ? 'border-accent bg-accent-soft text-accent-text' : 'border-border bg-surface text-fg hover:bg-surface-2'}`}
            >
              {on ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
              {STATUS_LABEL[s]}
            </button>
          );
        })}
      </div>
      {status === 'spam' ? <p className="m-0 text-[12px] leading-4 text-fg-muted">Marked as spam. Choose a stage to bring it back.</p> : null}
      <OutcomeText outcome={outcome} />
    </div>
  );
}

export function NoteForm({ id, label = 'Add a note', placeholder = 'Call outcome, next step…', compact = false }: { id: string; label?: string; placeholder?: string; compact?: boolean }) {
  const field = useId();
  const [body, setBody] = useState('');
  const { pending, outcome, run } = useSave();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    run(() => addLeadNote({ id, body }), 'Note saved.', () => setBody(''));
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Label htmlFor={field}>{label}</Label>
      <Textarea id={field} name="body" rows={3} maxLength={4000} required value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder} className="resize-y" />
      <div className={`flex items-center gap-3 ${compact ? '' : 'justify-end'}`}>
        <OutcomeText outcome={outcome} />
        <Button type="submit" size={36} loading={pending} disabled={!body.trim()} className="ml-auto">Save note</Button>
      </div>
    </form>
  );
}

/**
 * Branch (0023 lead_set_branch): free text with suggestions from the branches in use; blank clears it. Same rule as
 * the Add lead form (letter first; letters, spaces, dots, apostrophes, hyphens; 60 characters).
 */
export function BranchForm({ id, branch, branches }: { id: string; branch: string | null; branches: readonly string[] }) {
  const field = useId();
  const list = useId();
  const [value, setValue] = useState(branch ?? '');
  const { pending, outcome, run } = useSave();
  const unchanged = value.trim() === (branch ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (unchanged) return;
    run(() => setLeadBranch({ id, branch: value }), value.trim() ? `Branch set to ${value.trim()}.` : 'Branch cleared.');
  };
  return (
    <form onSubmit={submit} className="flex flex-col">
      <Label htmlFor={field}>Branch</Label>
      <div className="flex gap-2">
        <Input
          id={field} name="branch" value={value} maxLength={60} placeholder="Not set" autoComplete="off"
          pattern="[A-Za-z][A-Za-z .'\-]*" title="Letters, spaces, dots, apostrophes or hyphens"
          list={branches.length ? list : undefined} onChange={(e) => setValue(e.target.value)} className="h-11 py-0 lg:h-[38px]"
        />
        {branches.length ? <datalist id={list}>{branches.map((b) => <option key={b} value={b} />)}</datalist> : null}
        <Button type="submit" variant="secondary" size={38} className="max-lg:h-11" loading={pending} disabled={unchanged}>Save</Button>
      </div>
      <OutcomeText outcome={outcome} />
    </form>
  );
}

const bannerButton = 'inline-flex h-11 items-center rounded-pill px-3 text-small font-semibold text-inherit disabled:opacity-60 lg:h-8';

/**
 * Duplicate banner actions (design Leads: "Merge into …" and "Not a duplicate"). Merge asks for a confirmation first;
 * it keeps the original, links this lead to it (nothing is deleted) and then shows the original when `openOriginal`.
 */
export function DuplicateActions({ id, originalId, originalLabel, merge, notDuplicate, openOriginal = false }: {
  id: string;
  originalId: string;
  originalLabel: string;
  merge: boolean;
  notDuplicate: boolean;
  openOriginal?: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const { pending, outcome, run } = useSave();
  if (!merge && !notDuplicate) return null;
  const doMerge = () => run(() => mergeLead({ id, into: originalId }), `Merged into ${originalLabel}.`, () => {
    setConfirming(false);
    if (openOriginal) router.push(`/admin/leads/${originalId}`);
  });
  const dismiss = () => run(() => markNotDuplicate({ id, of: originalId }), 'Marked as not a duplicate.');
  return (
    <div className="flex basis-full flex-col gap-1" data-testid="lead-duplicate-actions">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="m-0 flex-[1_1_220px] text-small">
            Merge this lead into <strong>{originalLabel}</strong>? It is closed and linked to that lead; its details, notes and history are kept.
          </p>
          <button type="button" onClick={doMerge} disabled={pending} aria-busy={pending || undefined} className={`${bannerButton} border border-current bg-transparent`}>Confirm merge</button>
          <button type="button" onClick={() => setConfirming(false)} disabled={pending} className={`${bannerButton} bg-transparent underline`}>Cancel</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {merge ? <button type="button" onClick={() => setConfirming(true)} disabled={pending} className={`${bannerButton} border border-current bg-transparent`}>Merge into {originalLabel}</button> : null}
          {notDuplicate ? <button type="button" onClick={dismiss} disabled={pending} aria-busy={pending || undefined} className={`${bannerButton} bg-transparent underline`}>Not a duplicate</button> : null}
        </div>
      )}
      <p role={outcome?.kind === 'error' ? 'alert' : 'status'} className="m-0 min-h-4 text-[12px] leading-4">{outcome?.text ?? ''}</p>
    </div>
  );
}
