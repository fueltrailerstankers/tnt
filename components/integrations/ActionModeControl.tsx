'use client';

import { useId, useState, useTransition } from 'react';
import { switchActionMode } from '@/app/(admin)/admin/integrations/xero/actions/server-actions';
import { Spinner } from '@/components/ui/Spinner';
import { StatusChip } from '@/components/ui/StatusChip';
import { TypedConfirmModal } from '@/components/ui/TypedConfirmModal';
import type { ActionMode } from '@/lib/integrations/xero/write/modes';
import type { ActionName } from '@/lib/integrations/xero/write/types';
import { MODE_LABEL } from '@/lib/settings/xero-page';
import { livePhrase } from '@/lib/ui/confirm';

const ORDER: ActionMode[] = ['off', 'dry_run', 'live'];

/** Selected segment look per mode (design: Off on surface, Dry-run yellow, Live red). */
const SELECTED: Record<ActionMode, string> = {
  off: 'bg-surface text-fg shadow-card',
  dry_run: 'bg-status-yellow-bg text-status-yellow-fg',
  live: 'bg-danger text-white',
};

/**
 * Off / Dry-run / Live for one Xero write action. Off and Dry-run switch straight away; Live opens a typed
 * confirmation that only enables "Go live" for exactly "LIVE <action>". The server action re-checks the phrase,
 * the admin permission and the write scopes, and writes the audit row. Buttons (not arrow-key radios), so moving
 * focus never changes a mode by itself.
 */
export function ActionModeControl({ action, mode, canConfigure, liveBlocked }: {
  action: ActionName;
  mode: ActionMode;
  canConfigure: boolean;
  /** Why Live cannot be chosen now (plan only, no write scopes...), or null. */
  liveBlocked: string | null;
}) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const noteId = useId();

  if (!canConfigure) return <StatusChip status={MODE_LABEL[mode]} color={mode === 'live' ? 'red' : mode === 'dry_run' ? 'yellow' : 'gray'} size="sm" />;

  const pick = (to: ActionMode) => {
    if (to === mode || pending) return;
    setMessage(null);
    if (to === 'live') { setConfirming(true); return; }
    start(async () => {
      const r = await switchActionMode({ action, mode: to });
      setMessage(r.error ? { tone: 'error', text: r.error } : null);
    });
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <div role="group" aria-label={`${action} mode`} aria-describedby={liveBlocked ? noteId : undefined} className="inline-flex gap-0.5 rounded-pill border border-border bg-surface-2 p-[3px]" data-testid={`mode-${action}`}>
          {ORDER.map((m) => {
            const on = m === mode;
            const blocked = m === 'live' && !on && !!liveBlocked;
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                disabled={pending || blocked}
                onClick={() => pick(m)}
                className={`h-7 rounded-pill px-3 text-[12px] font-semibold disabled:cursor-not-allowed ${on ? SELECTED[m] : 'text-fg-muted hover:text-fg disabled:opacity-60 disabled:hover:text-fg-muted'}`}
              >
                {MODE_LABEL[m]}
              </button>
            );
          })}
        </div>
        {pending ? <span className="inline-flex items-center gap-1 text-[12px] text-fg-muted"><Spinner size={14} />Saving…</span> : null}
      </div>
      {liveBlocked ? <p id={noteId} className="text-[12px] text-fg-muted">Live: {liveBlocked}</p> : null}
      <p aria-live="polite" className={`text-[12px] ${message?.tone === 'error' ? 'text-status-red-fg' : 'text-status-green-fg'}`}>{message?.text ?? ''}</p>

      <TypedConfirmModal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={<>Switch <span className="font-mono">{action}</span> to Live?</>}
        body="The portal will start writing to Xero for this action. Turn off the matching Make.com scenario first, or Xero will get duplicate writes."
        phrase={livePhrase(action)}
        confirmLabel="Go live"
        onConfirm={async (typed) => {
          const r = await switchActionMode({ action, mode: 'live', confirm: typed });
          if (r.error) return { ok: false, message: r.error };
          setMessage({ tone: 'ok', text: `${action} is Live.` });
          return { ok: true };
        }}
      />
    </div>
  );
}
