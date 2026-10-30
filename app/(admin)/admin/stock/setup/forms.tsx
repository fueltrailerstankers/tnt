'use client';

import { startTransition, useActionState, useState, type ChangeEvent, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { FieldError, Input, Label } from '@/components/ui/Field';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { cardClass } from '@/components/ui/styles';
import { lineList, OPENING_MAX_CHARS, OPENING_TEMPLATE_HEADER, type OpeningReport } from '@/lib/stock/opening';
import { LIVE_CONFIRMATION, RULE_MODE_ABOUT, RULE_MODE_LABEL, type InvoiceRuleMode } from '@/lib/stock/settings';
import { importOpeningStock, rebuildDeals, saveInvoiceRules, saveStartDate, type OpeningState, type SetupState } from './actions';

/** Dispatches without React's automatic form reset, so values survive an error. */
const submitWith = (dispatch: (fd: FormData) => void) => (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  startTransition(() => dispatch(fd));
};

function Result({ state }: { state: SetupState }) {
  if (state.error) return <FieldError>{state.error}</FieldError>;
  if (state.ok) return <p role="status" className="text-body font-semibold text-status-green-fg">{state.ok}</p>;
  return null;
}

export function StartDateForm({ current }: { current: string | null }) {
  const [state, dispatch, pending] = useActionState(saveStartDate, {} as SetupState);
  return (
    <form onSubmit={submitWith(dispatch)} className="space-y-3" data-testid="start-date-form" noValidate>
      <div className="max-w-xs">
        <Label htmlFor="stock-start">Stock start date</Label>
        <Input id="stock-start" type="date" name="start" defaultValue={current ?? ''} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save start date'}</Button>
        <Result state={state} />
      </div>
    </form>
  );
}

const MODES: InvoiceRuleMode[] = ['off', 'preview', 'live'];

export function InvoiceRulesForm({ current }: { current: InvoiceRuleMode }) {
  const [state, dispatch, pending] = useActionState(saveInvoiceRules, {} as SetupState);
  const [mode, setMode] = useState<InvoiceRuleMode>(current);
  return (
    <form onSubmit={submitWith(dispatch)} className="space-y-3" data-testid="rules-form" noValidate>
      <SegmentedControl name="mode" label="Invoice rules" value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m, label: RULE_MODE_LABEL[m] }))} />
      <p className="text-small text-fg-muted">{RULE_MODE_ABOUT[mode]}</p>
      {mode === 'live' && current !== 'live' ? (
        <div className="max-w-xs">
          <Label htmlFor="rules-confirm" required>Type <code>{LIVE_CONFIRMATION}</code> to confirm</Label>
          <Input id="rules-confirm" name="confirm" autoComplete="off" />
        </div>
      ) : <input type="hidden" name="confirm" value={mode === 'live' ? LIVE_CONFIRMATION : ''} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save invoice rules'}</Button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function RebuildDealsForm() {
  const [state, dispatch, pending] = useActionState(rebuildDeals, {} as SetupState);
  return (
    <form onSubmit={submitWith(dispatch)} className="flex flex-wrap items-center gap-3" data-testid="rebuild-form">
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? 'Queuing…' : 'Rebuild deals'}</Button>
      <Result state={state} />
    </form>
  );
}

const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(`${OPENING_TEMPLATE_HEADER}\r\n`)}`;

function Lines({ label, lines, testId }: { label: string; lines: number[]; testId?: string }) {
  if (!lines.length) return null;
  return <li data-testid={testId}>{label}: line{lines.length === 1 ? '' : 's'} {lineList(lines)}</li>;
}

/** Unknown models and locations are listed once per value above the line-by-line problems. */
const listedAbove = (r: OpeningReport, e: OpeningReport['errors'][number]) =>
  (e.field === 'model' && r.unknownModels.some((m) => m.lines.includes(e.line)))
  || (e.field === 'location' && r.unknownLocationLines.includes(e.line));

function ReportView({ report }: { report: OpeningReport }) {
  const blocked = report.missingColumns.length > 0 || report.tooManyRows;
  return (
    <div className="space-y-3" data-testid="opening-report">
      {report.missingColumns.length ? (
        <p role="alert" className="rounded-sm bg-status-red-bg p-2 text-body text-status-red-fg">Missing columns: {report.missingColumns.join(', ')}.</p>
      ) : null}
      {report.tooManyRows ? (
        <p role="alert" className="rounded-sm bg-status-red-bg p-2 text-body text-status-red-fg">The file has {report.totalRows} rows; import at most 5,000 at a time.</p>
      ) : null}
      {!blocked ? (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Rows', report.totalRows, 'rows'],
            ['New units', report.toInsert, 'new'],
            ['Already registered', report.alreadyRegistered, 'existing'],
            ['Problems', report.errorCount, 'problems'],
          ].map(([label, n, id]) => (
            <div key={id} className="rounded-sm bg-surface-2 p-2">
              <dt className="text-small text-fg-muted">{label}</dt>
              <dd className="text-h2 tabular-nums" data-testid={`opening-${id}`}>{n}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {report.errorCount ? (
        <div className="rounded-sm border border-border p-3">
          <h3 className="text-body font-semibold">Problems to fix</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-body" data-testid="opening-problem-list">
            {report.duplicates.map((d) => <li key={d.vin}>VIN {d.vin} appears more than once: lines {lineList(d.lines)}</li>)}
            {report.unknownModels.map((m) => <li key={m.model}>Unknown model {m.model}: line{m.lines.length === 1 ? '' : 's'} {lineList(m.lines)}</li>)}
            <Lines label="Unknown location" lines={report.unknownLocationLines} />
            <Lines label="Invoice number used on more than one line" lines={report.duplicateInvoiceLines} />
            {report.invoiceConflicts.map((c) => <li key={c.line}>Line {c.line} (VIN {c.vin}): the invoice number is already on another unit</li>)}
            {report.errors.filter((e) => !listedAbove(report, e)).map((e) => <li key={`${e.line}-${e.field}`}>Line {e.line}: {e.message}</li>)}
          </ul>
        </div>
      ) : null}
      {report.alreadyRegistered ? (
        <p className="text-small text-fg-muted">
          Registered VINs are left unchanged; correct them on the unit record.
          {report.differing ? ` ${report.differing} differ from the file: ${report.differingVins.slice(0, 20).join(', ')}${report.differing > 20 ? '…' : ''}.` : ''}
        </p>
      ) : null}
      {report.noInvoiceLines.length ? (
        <p className="text-small text-fg-muted">Reserved or sold without an invoice number (allowed): line{report.noInvoiceLines.length === 1 ? '' : 's'} {lineList(report.noInvoiceLines)}.</p>
      ) : null}
    </div>
  );
}

/** Opening stock CSV: choose a file -> Check file (dry run) -> Import. The file text is sent with each step. */
export function OpeningStockImport() {
  const [state, dispatch, pending] = useActionState(importOpeningStock, {} as OpeningState);
  const [csv, setCsv] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    setChecked(false);
    setFileError(null);
    setCsv('');
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > OPENING_MAX_CHARS) {
      setFileError('The file is too large (about 900 KB, 5,000 rows at most).');
      return;
    }
    setCsv(await f.text());
  };
  const run = (intent: 'check' | 'apply') => {
    const fd = new FormData();
    fd.set('intent', intent);
    fd.set('csv', csv);
    if (intent === 'check') setChecked(true);
    startTransition(() => dispatch(fd));
  };
  const report = checked ? state.report : undefined;

  return (
    <div className="space-y-3" data-testid="opening-import">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <Label htmlFor="opening-file">Opening stock CSV</Label>
          <Input id="opening-file" type="file" accept=".csv,text/csv" onChange={onFile} />
        </div>
        <Button type="button" variant="secondary" disabled={!csv || pending} onClick={() => run('check')}>{pending ? 'Working…' : 'Check file'}</Button>
        <Button type="button" disabled={!csv || pending || !report?.canApply || !!state.applied} onClick={() => run('apply')}>Import units</Button>
      </div>
      <p className="text-small text-fg-muted">
        Columns: {OPENING_TEMPLATE_HEADER.replaceAll(',', ', ')}. VIN, Model, Location and Status are required. Status is available, reserved or sold;
        location is Factory or a branch. <a href={TEMPLATE_HREF} download="opening-stock-template.csv" className="font-semibold text-accent-text underline">Download the template</a>.
      </p>
      {fileError ? <FieldError>{fileError}</FieldError> : null}
      {checked ? <Result state={state} /> : null}
      {report ? <div className={`${cardClass} p-3`}><ReportView report={report} /></div> : null}
    </div>
  );
}
