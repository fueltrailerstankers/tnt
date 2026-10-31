'use client';

import { useActionState, useState } from 'react';
import { saveOrg, type OrgState } from '@/app/(admin)/admin/settings/actions';
import { Button } from '@/components/ui/Button';
import { inputClass, labelClass } from '@/components/ui/styles';
import { DISPLAY_CURRENCIES, FX_SOURCES, timezoneLabel } from '@/lib/settings/org';

export interface OrgFormValues { name: string; currency: string; timezone: string; fxRate: string }

function FieldError({ id, text }: { id: string; text?: string }) {
  return text ? <p id={id} className="m-0 text-small text-status-red-fg">{text}</p> : null;
}

/** Settings > Organisation (Settings.dc.html). Read-only when the member cannot manage settings. */
export function OrgForm({ values, zones, manage }: { values: OrgFormValues; zones: string[]; manage: boolean }) {
  const [state, action, pending] = useActionState(saveOrg, {} as OrgState);
  // Controlled: React resets uncontrolled fields after a form action, which would drop what was typed on an error.
  const [f, setF] = useState({ ...values, currency: values.currency === 'ZAR' ? 'ZAR' : 'USD', fxSource: 'manual' });
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (ev: { target: { value: string } }) => setF((p) => ({ ...p, [k]: ev.target.value })) });
  const e = state.errors ?? {};
  const err = (k: keyof typeof e) => (e[k] ? { 'aria-invalid': true as const, 'aria-describedby': `org-${k}-err` } : {});
  const select = `${inputClass} h-[38px] py-0`;
  return (
    <form action={action} className="grid max-w-[720px] grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-[18px] rounded-md border border-border bg-surface p-[22px] shadow-card" data-testid="org-form">
      {state.ok ? <p role="status" className="col-span-full m-0 rounded-sm bg-status-green-bg px-3 py-2 text-small font-semibold text-status-green-fg">Saved.</p> : null}
      {state.error || Object.keys(e).length ? <p role="alert" className="col-span-full m-0 rounded-sm bg-status-red-bg px-3 py-2 text-small text-status-red-fg">{state.error ?? 'Check the highlighted fields.'}</p> : null}
      <fieldset disabled={!manage || pending} className="contents">
        <legend className="sr-only">Organisation</legend>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="org-name" className={labelClass}>Organisation name</label>
          <input id="org-name" name="name" {...bind('name')} required maxLength={120} className={inputClass} {...err('name')} />
          <FieldError id="org-name-err" text={e.name} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="org-currency" className={labelClass}>Display currency</label>
          <select id="org-currency" name="currency" {...bind('currency')} aria-describedby="org-currency-help" className={select} {...err('currency')}>
            {DISPLAY_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
          <p id="org-currency-help" className="m-0 text-[12px] text-fg-muted">Xero amounts always show in ZAR with a badge.</p>
          <FieldError id="org-currency-err" text={e.currency} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="org-tz" className={labelClass}>Timezone</label>
          <select id="org-tz" name="timezone" {...bind('timezone')} className={select} {...err('timezone')}>
            {zones.map((z) => <option key={z} value={z}>{timezoneLabel(z)}</option>)}
          </select>
          <FieldError id="org-timezone-err" text={e.timezone} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="org-fx-source" className={labelClass}>ZAR → USD rate source</label>
          <select id="org-fx-source" name="fxSource" {...bind('fxSource')} aria-describedby="org-fx-source-help" className={select} {...err('fxSource')}>
            {FX_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <p id="org-fx-source-help" className="m-0 text-[12px] text-fg-muted">A daily feed is not connected yet.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="org-fx-rate" className={labelClass}>USD per 1 ZAR</label>
          <input
            id="org-fx-rate" name="fxRate" {...bind('fxRate')} inputMode="decimal" autoComplete="off" placeholder="e.g. 0.0547"
            className={`${inputClass} font-mono`} aria-describedby={e.fxRate ? 'org-fxRate-err org-fx-help' : 'org-fx-help'} aria-invalid={e.fxRate ? true : undefined}
          />
          <p id="org-fx-help" className="m-0 text-[12px] text-fg-muted">Shown as “≈ USD” under ZAR amounts. Leave blank to show ZAR only.</p>
          <FieldError id="org-fxRate-err" text={e.fxRate} />
        </div>
      </fieldset>
      <div className="col-span-full flex flex-wrap items-center justify-end gap-2">
        {manage ? <Button type="submit" size={38} loading={pending}>Save changes</Button>
          : <p className="m-0 text-small text-fg-muted">Read only: you can view these settings but not change them.</p>}
      </div>
    </form>
  );
}
