'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { TONE_FILL } from '@/components/home/tone';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { StatusChip } from '@/components/ui/StatusChip';
import { setStatus } from '@/app/(admin)/admin/forms/[slug]/actions';
import { syncNow } from '@/app/(admin)/admin/integrations/xero/actions';
import {
  emptyCopy, filterRows, STORE_ROOM_SLUG, taskCounts, type TaskActionResult, type TaskFilter, type TaskRow,
} from '@/lib/tasks/build';
import { inspectionTaskAction } from './actions';
import { PANEL_ID, tabId, TaskFilters } from './TaskFilters';

type Notice = { tone: 'success' | 'error'; text: string; href?: string; linkLabel?: string; reload?: boolean } | null;

const ACTION_H = 'h-11 lg:h-[34px]';
const SECONDARY = `inline-flex ${ACTION_H} items-center rounded-pill border border-border-strong px-3 text-small font-medium text-fg no-underline hover:bg-surface-2`;
const PRIMARY = `inline-flex ${ACTION_H} items-center justify-center gap-1.5 rounded-pill border border-transparent bg-accent px-3 text-small font-semibold text-accent-fg no-underline hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50`;
const QUIET = `inline-flex ${ACTION_H} items-center justify-center gap-1.5 rounded-pill border border-border-strong bg-surface-2 px-3 text-small font-semibold text-fg hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50`;

/** Submit button for the forms that post to existing server actions (manual status, Xero sync). */
function PostButton({ label, quiet = false, disabled = false }: { label: string; quiet?: boolean; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={quiet ? QUIET : PRIMARY} disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending ? <Icon name="spinner" size={14} strokeWidth={2} className="motion-safe:animate-spin" /> : null}
      {label}
    </button>
  );
}

/**
 * The Tasks list (design Tasks): filter chips with live counts and one row per task. Inspection steps run here
 * (server action, optimistic removal, inline status); Store Room and sync retry post to the existing
 * permission-checked actions; leads and job details are links.
 */
export function TaskList({ rows, filters, initialFilter }: { rows: TaskRow[]; filters: TaskFilter[]; initialFilter: TaskFilter }) {
  const router = useRouter();
  const [filter, setFilter] = useState<TaskFilter>(initialFilter);
  const [live, hide] = useOptimistic(rows, (state: TaskRow[], id: string) => state.filter((r) => r.id !== id));
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const focusNext = useRef<string | null>(null);

  const counts = taskCounts(live);
  const shown = filterRows(live, filter);

  const choose = (f: TaskFilter) => {
    setFilter(f);
    try {
      const url = new URL(window.location.href);
      if (f === 'all') url.searchParams.delete('filter');
      else url.searchParams.set('filter', f);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // URL mirroring is a convenience only.
    }
  };

  // After a row is done, move focus to the next row (or the page heading when the list is empty).
  useEffect(() => {
    if (isPending || !focusNext.current) return;
    const id = focusNext.current;
    focusNext.current = null;
    const next = id === 'heading' ? null : document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"] a, [data-task-id="${CSS.escape(id)}"] button`);
    (next ?? document.getElementById('tasks-title'))?.focus();
  }, [isPending, live]);

  const runInspection = (row: TaskRow) => {
    const p = row.primary;
    if (!p || p.type !== 'inspection') return;
    const i = shown.findIndex((r) => r.id === row.id);
    const after = shown[i + 1] ?? shown[i - 1] ?? null;
    setNotice(null);
    setBusyId(row.id);
    startTransition(async () => {
      hide(row.id);
      let res: TaskActionResult;
      try {
        res = await inspectionTaskAction({ kind: p.action, entryId: p.entryId, version: p.version });
      } catch {
        res = { ok: false, message: 'This action could not be completed. Reload the page and try again.' };
      }
      setBusyId(null);
      if (res.ok) {
        setNotice({ tone: 'success', text: res.message });
        focusNext.current = after?.id ?? 'heading';
      } else {
        setNotice({ tone: 'error', text: res.message, href: res.href, linkLabel: res.linkLabel, reload: /changed by someone else/.test(res.message) });
      }
    });
  };

  const empty = emptyCopy(filter);

  return (
    <>
      {/* Live regions stay mounted (zero height when empty) so screen readers announce results. */}
      <div className="flex flex-col">
        <TaskFilters filters={filters} value={filter} counts={counts} onChange={choose} />
        <div role="status">
          {notice?.tone === 'success' ? (
            <p className="mb-0 mt-4 flex items-center gap-2.5 rounded-md border border-border bg-surface px-3.5 py-3 text-body font-semibold text-fg shadow-card">
              <span className="flex-none text-status-green-fg"><Icon name="check" size={18} strokeWidth={2} /></span>
              {notice.text}
            </p>
          ) : null}
        </div>
        <div role="alert">
          {notice?.tone === 'error' ? (
            <div className="mt-4 flex gap-2.5 rounded-md bg-status-red-bg px-3.5 py-3 text-status-red-fg">
              <span className="mt-0.5 flex-none"><Icon name="warning" size={18} strokeWidth={2} /></span>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <p className="m-0 text-body font-semibold">{notice.text}</p>
                {notice.href ? <Link href={notice.href} className="text-small font-semibold text-status-red-fg underline">{notice.linkLabel ?? 'Open'}</Link> : null}
                {notice.reload ? (
                  <button type="button" onClick={() => { setNotice(null); router.refresh(); }} className="text-small font-semibold text-status-red-fg underline">
                    Reload
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <section id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(filter)} className="rounded-md border border-border bg-surface shadow-card">
        {shown.length ? (
          <ul data-testid="tasks-list" className="m-0 list-none divide-y divide-border p-0">
            {shown.map((t) => (
              <li key={t.id} data-testid={t.testId} data-task-id={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5">
                <span aria-hidden="true" className={`flex size-9 flex-none items-center justify-center rounded-md ${TONE_FILL[t.tone]}`}>
                  <Icon name={t.icon} size={18} />
                </span>
                <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-[3px] lg:flex-[1_1_320px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={t.href} className="text-[15px] font-semibold leading-[22px] text-fg no-underline hover:underline">{t.title}</Link>
                    <StatusChip status={t.status} color={t.statusTone} />
                  </div>
                  <p className="m-0 text-small text-fg-muted">{t.meta}</p>
                </div>
                <span className="flex-none text-small text-fg-muted lg:w-[110px]">{t.age}</span>
                <div className="ml-auto flex flex-none flex-wrap gap-2 lg:ml-0">
                  {t.secondary ? <Link href={t.secondary.href} className={SECONDARY}>{t.secondary.label}</Link> : null}
                  {t.primary?.type === 'inspection' ? (
                    <button
                      type="button"
                      className={PRIMARY}
                      disabled={isPending}
                      aria-busy={busyId === t.id || undefined}
                      onClick={() => runInspection(t)}
                    >
                      {busyId === t.id ? <Icon name="spinner" size={14} strokeWidth={2} className="motion-safe:animate-spin" /> : null}
                      {t.primary.label}
                    </button>
                  ) : t.primary?.type === 'store-room' ? (
                    <form action={setStatus.bind(null, STORE_ROOM_SLUG, t.primary.number)}>
                      <input type="hidden" name="status" value={t.primary.status} />
                      <PostButton label={t.primary.label} disabled={isPending} />
                    </form>
                  ) : t.primary?.type === 'sync-retry' ? (
                    <form action={syncNow}>
                      <PostButton label={t.primary.label} quiet disabled={isPending} />
                    </form>
                  ) : t.primary?.type === 'link' ? (
                    <Link href={t.primary.href} className={PRIMARY}>{t.primary.label}</Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            variant="plain"
            title={empty.title}
            body={empty.body}
            action={filter === 'all' ? <Link href="/admin/forms">Go to forms</Link> : undefined}
          />
        )}
      </section>
    </>
  );
}
