'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition, type FormEvent } from 'react';
import { addLeadNote, setLeadAssignee, setLeadStatus } from '@/app/(admin)/admin/leads/actions';
import { Button } from '@/components/ui/Button';
import { Label, Select, Textarea } from '@/components/ui/Field';
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
        <Select id={field} name="status" value={value} onChange={(e) => setValue(e.target.value)} className="h-[38px] py-0">
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
        <Button type="submit" variant="secondary" size={38} loading={pending} disabled={value === status}>Set status</Button>
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
        <Select id={field} name="assigned_to" value={value} onChange={(e) => setValue(e.target.value)} className="h-[38px] py-0">
          <option value="">Unassigned</option>
          {members.map((m) => <option key={m.userId} value={m.userId}>{m.label}</option>)}
        </Select>
        <Button type="submit" variant="secondary" size={38} loading={pending} disabled={value === (assigned ?? '')}>Assign</Button>
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
