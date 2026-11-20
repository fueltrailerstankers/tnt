'use client';

import { useActionState, useState } from 'react';
import { saveFxAuto, type FxAutoState } from '@/app/(admin)/admin/settings/actions';
import { Button } from '@/components/ui/Button';

/**
 * Settings > Organisation: the daily ZAR -> USD feed toggle (app_settings fx.auto). Off keeps the manual rate as
 * typed; on lets the fx.refresh job replace it once a day. Read-only without settings.manage.
 */
export function FxFeedForm({ auto, configured, updated, manage }: { auto: boolean; configured: boolean; updated: string | null; manage: boolean }) {
  const [state, action, pending] = useActionState(saveFxAuto, {} as FxAutoState);
  // Controlled, so a failed save keeps what was ticked.
  const [on, setOn] = useState(auto);
  return (
    <form action={action} className="flex max-w-[720px] flex-col gap-3 rounded-md border border-border bg-surface p-[22px] shadow-card" data-testid="fx-feed-form">
      <h2 className="text-h2 text-fg">Daily exchange rate feed</h2>
      {state.ok ? <p role="status" className="m-0 rounded-sm bg-status-green-bg px-3 py-2 text-small font-semibold text-status-green-fg">Saved.</p> : null}
      {state.error ? <p role="alert" className="m-0 rounded-sm bg-status-red-bg px-3 py-2 text-small text-status-red-fg">{state.error}</p> : null}
      <fieldset disabled={!manage || pending} className="contents">
        <legend className="sr-only">Daily exchange rate feed</legend>
        <label className="flex items-start gap-3 text-body text-fg">
          <input
            type="checkbox" name="fxAuto" checked={on} onChange={(e) => setOn(e.target.checked)} aria-describedby="fx-auto-help"
            className="mt-0.5 h-5 w-5 flex-none accent-accent"
          />
          <span className="font-semibold">Update the USD per 1 ZAR rate every day from the feed</span>
        </label>
        <p id="fx-auto-help" className="m-0 text-[12px] text-fg-muted">
          {configured
            ? 'When on, the daily feed replaces the rate above each morning. When off, the rate you type is kept.'
            : 'No feed is configured on the server (FX_RATE_URL), so the rate you type is kept either way.'}
        </p>
        {updated ? <p className="m-0 text-small text-fg-muted" data-testid="fx-updated">{updated}</p> : null}
      </fieldset>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {manage ? <Button type="submit" size={38} loading={pending} variant="secondary">Save feed setting</Button> : null}
      </div>
    </form>
  );
}
