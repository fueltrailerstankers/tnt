import Link from 'next/link';
import { StatusChip } from '@/components/ui/StatusChip';
import { cardClass } from '@/components/ui/styles';
import { formatDateTime } from '@/lib/admin/grid';
import { loadOrg } from '@/lib/forms/org';
import { importableForms, RUN_SELECT, type ImportRun } from '@/lib/import/cognito/job';
import { apiKeyInfo } from '@/lib/import/cognito/key';
import { errorText, parseReport, statusLabel, sumCounts, totalReport, type RunStatus } from '@/lib/import/cognito/progress';
import type { FormReport } from '@/lib/import/cognito/report';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { AutoRefresh, KeyForm, RemoveKey, RunControl, RunForm, TestConnection } from './controls';

export const dynamic = 'force-dynamic';
// Start/Resume run the first import step right after responding (next/server `after`).
export const maxDuration = 60;
export const metadata = { title: 'Import from Cognito · Trailers & Tankers' };

const TONE: Record<RunStatus, string> = { queued: 'gray', running: 'teal', paused: 'yellow', done: 'green', failed: 'red' };
const MODE = { dry_run: 'Dry run', apply: 'Import' } as const;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

const num = (n: number) => n.toLocaleString('en-ZA');

function reasons(m: Record<string, number>): string {
  const keys = Object.keys(m).filter((k) => m[k]).sort();
  return keys.length ? keys.map((k) => `${k.replaceAll('_', ' ')} ${num(m[k])}`).join(', ') : '';
}

/** Counts only: no names, emails, ID numbers, file names or values (the report never holds them). */
function Report({ r, apply, testId }: { r: FormReport; apply: boolean; testId?: string }) {
  const skipped = sumCounts(r.skipped);
  const failed = sumCounts(r.failed);
  const unknown = Object.keys(r.unknownFields).sort();
  const issues = reasons(r.issues);
  const row = (label: string, value: React.ReactNode, key: string, warn = false) => (
    <div className="flex justify-between gap-3 border-b border-border py-1 last:border-b-0" data-testid={testId ? `${testId}-${key}` : undefined}>
      <dt className="text-fg-muted">{label}</dt>
      <dd className={`text-right tabular-nums ${warn ? 'font-semibold text-status-red-fg' : 'text-fg'}`}>{value}</dd>
    </div>
  );
  return (
    <dl className="grid gap-x-6 text-small sm:grid-cols-2" data-testid={testId}>
      {row('Seen in Cognito', <>{num(r.seen)}{r.expected !== null ? <span className="text-fg-muted"> (about {num(r.expected)} at export)</span> : null}</>, 'seen')}
      {row('To import', num(r.toImport), 'to-import')}
      {row('Already imported', num(r.alreadyImported), 'already')}
      {apply ? row('Imported', num(r.imported), 'imported') : null}
      {r.resumable ? row('Half-imported earlier (finished now)', num(r.resumable), 'resumable') : null}
      {row('Skipped', <>{num(skipped)}{skipped ? <span className="block text-fg-muted">{reasons(r.skipped)}</span> : null}</>, 'skipped')}
      {row('Failed', <>{num(failed)}{failed ? <span className="block">{reasons(r.failed)}</span> : null}</>, 'failed', failed > 0)}
      {row('Files', <>{num(r.files.count)} ({fmtBytes(r.files.bytes)}{r.files.unknownSize ? `, ${num(r.files.unknownSize)} without size` : ''})</>, 'files')}
      {row('Signatures', <>{num(r.signatures.count)} ({fmtBytes(r.signatures.bytes)}{r.signatures.unknownSize ? `, ${num(r.signatures.unknownSize)} without size` : ''})</>, 'signatures')}
      {apply ? row('Stored', `${num(r.stored.files)} files (${fmtBytes(r.stored.bytes)})`, 'stored') : null}
      {r.lookups.resolved + r.lookups.pendingSource + r.lookups.unresolved
        ? row('Quote no links', `linked ${num(r.lookups.resolved)}, RFI in this run ${num(r.lookups.pendingSource)}, not found ${num(r.lookups.unresolved)}`, 'lookups')
        : null}
      {unknown.length ? row('Unknown Cognito fields (not stored)', unknown.map((k) => `${k} (${r.unknownFields[k].withValue} with value)`).join(', '), 'unknown') : null}
      {issues ? row('Value issues', issues, 'issues') : null}
      {r.maxNumber !== null ? row('Highest entry number', num(r.maxNumber), 'max') : null}
      {r.counterSetTo !== null ? row('Next platform number after', num(r.counterSetTo), 'counter') : null}
      {r.stoppedAtLimit ? row('Stopped at the limit', 'yes', 'limit') : null}
    </dl>
  );
}

function RunLine({ run, tz, now }: { run: ImportRun; tz: string; now: number }) {
  const leaseActive = !!run.lease_until && new Date(run.lease_until).getTime() > now;
  const label = statusLabel(run.status, leaseActive, run.stop_requested);
  const when = run.finished_at ?? run.started_at ?? run.created_at;
  return (
    <div className="flex flex-wrap items-center gap-2 text-small">
      <StatusChip status={label} color={TONE[run.status]} />
      <span className="font-semibold text-fg">{MODE[run.mode]}</span>
      <span className="text-fg-muted">{formatDateTime(when, tz)}</span>
      {run.error ? <span className="basis-full text-status-red-fg">{errorText(run.error)}</span> : null}
    </div>
  );
}

export default async function CognitoImportPage() {
  const member = await requirePerm('import.run');
  const userDb = await createClient();
  // cognito_api_keys is a service-only table: read (last 4 characters and date only) after the permission check.
  const db = createAdminClient();
  const [org, key, forms, runsRes] = await Promise.all([
    loadOrg(userDb, member.orgId),
    apiKeyInfo(db, member.orgId),
    importableForms(userDb, member.orgId),
    // import_runs through RLS (org admins only).
    userDb.from('import_runs').select(RUN_SELECT).eq('org_id', member.orgId).order('created_at', { ascending: false }).limit(60),
  ]);
  const runs = (runsRes.data ?? []) as ImportRun[];
  const tz = org.timezone;
  const now = Date.now();
  const active = runs.some((r) => r.status === 'queued' || r.status === 'running');
  const latest = new Map<string, ImportRun>();
  for (const r of runs) if (!latest.has(r.form_slug)) latest.set(r.form_slug, r);
  const latestBatch = runs.find((r) => r.batch_id)?.batch_id ?? null;
  const batchRuns = latestBatch ? runs.filter((r) => r.batch_id === latestBatch).sort((a, b) => a.seq - b.seq) : [];
  const batchReports = batchRuns.map((r) => parseReport(r.report)).filter((r): r is FormReport => !!r);
  const batchActive = batchRuns.find((r) => r.status === 'queued' || r.status === 'running');
  const batchResumable = !batchActive ? batchRuns.find((r) => r.status === 'paused' || r.status === 'failed') : undefined;
  const busy = (slug: string) => {
    const r = latest.get(slug);
    return !!r && (r.status === 'queued' || r.status === 'running');
  };

  return (
    <section className="max-w-4xl space-y-4">
      <p className="text-small"><Link href="/admin/forms">← Forms</Link></p>
      <h1 className="text-h1">Import from Cognito</h1>
      <p className="text-body text-fg-muted">
        Reads entries from Cognito Forms with an API key and saves them here exactly as the forms would have (numbers,
        status, dates, files and signatures). Start with a dry run: it reads Cognito and writes nothing. Import is safe to
        repeat: entries already imported are skipped, so a second import adds nothing new.
      </p>
      <AutoRefresh active={active} />

      <div className={`${cardClass} space-y-3 p-4`} data-testid="cognito-key">
        <h2 className="text-h2">API key</h2>
        {key ? (
          <p className="text-body" data-testid="cognito-key-status">
            A key ending in <span className="font-mono">{key.last4}</span> is saved ({formatDateTime(key.createdAt, tz)}
            {key.createdBy === member.userId ? ', by you' : ''}). It is stored encrypted and is never shown again.
          </p>
        ) : (
          <p className="text-body" data-testid="cognito-key-status">No key saved. Create one in Cognito (Organization settings → Integrations → API) with read access to forms, entries and files.</p>
        )}
        <KeyForm hasKey={!!key} />
        {key ? (
          <div className="flex flex-wrap items-start gap-3 border-t border-border pt-3">
            <div className="grow"><TestConnection /></div>
            <RemoveKey />
          </div>
        ) : null}
      </div>

      <div className={`${cardClass} space-y-3 p-4`} id="form-all" data-testid="import-all">
        <h2 className="text-h2">All forms</h2>
        <p className="text-small text-fg-muted">Runs every form in order (Request for invoice before Delivery Note, so Quote no links resolve). Stop and Resume apply to the whole set.</p>
        {batchRuns.length ? (
          <div className="space-y-2">
            <ul className="space-y-1">
              {batchRuns.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-small">
                  <span className="min-w-40 text-fg">{forms.find((f) => f.slug === r.form_slug)?.name ?? r.form_slug}</span>
                  <RunLine run={r} tz={tz} now={now} />
                </li>
              ))}
            </ul>
            {batchReports.length ? (
              <details className="rounded-md border border-border p-3">
                <summary className="cursor-pointer text-small font-semibold">Totals for this set</summary>
                <div className="mt-2"><Report r={totalReport(batchReports)} apply={batchRuns[0].mode === 'apply'} testId="report-all" /></div>
              </details>
            ) : null}
            {batchActive || batchResumable ? (
              <RunControl key={latestBatch!} run={(batchActive ?? batchResumable)!.id} op={batchActive ? 'stop' : 'resume'} />
            ) : null}
          </div>
        ) : null}
        <RunForm form="all" label="all forms" disabled={!key || forms.some((f) => busy(f.slug))} />
      </div>

      <ul className="space-y-3">
        {forms.map((f) => {
          const run = latest.get(f.slug);
          const report = run ? parseReport(run.report) : null;
          const isBusy = busy(f.slug);
          const resumable = run && (run.status === 'paused' || run.status === 'failed');
          return (
            <li key={f.slug} id={`form-${f.slug}`} className={`${cardClass} space-y-3 p-4`} data-testid={`import-form-${f.slug}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-h2"><Link href={`/admin/forms/${f.slug}`} className="text-fg no-underline hover:underline">{f.name}</Link></h2>
                <span className="text-small text-fg-muted">
                  Cognito form {f.spec.cognitoFormId}{f.spec.entryCountAtExport !== null ? ` · about ${num(f.spec.entryCountAtExport)} entries at export` : ''}
                </span>
              </div>
              {run ? (
                <div className="space-y-2" data-testid={`run-${f.slug}`}>
                  <RunLine run={run} tz={tz} now={now} />
                  {report ? <Report r={report} apply={run.mode === 'apply'} testId={`report-${f.slug}`} /> : <p className="text-small text-fg-muted">Waiting to start.</p>}
                  {(isBusy || resumable) && !run.batch_id ? <RunControl key={run.id} run={run.id} op={isBusy ? 'stop' : 'resume'} /> : null}
                </div>
              ) : (
                <p className="text-small text-fg-muted">Not run yet.</p>
              )}
              <RunForm form={f.slug} label={f.name} disabled={!key || isBusy} />
            </li>
          );
        })}
      </ul>

      {runs.length ? (
        <details className={`${cardClass} p-4`}>
          <summary className="cursor-pointer text-h2">Earlier runs</summary>
          <ul className="mt-3 divide-y divide-border">
            {runs.map((r) => {
              const rep = parseReport(r.report);
              return (
                <li key={r.id} className="space-y-1 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-small">
                    <span className="min-w-40 font-semibold text-fg">{forms.find((f) => f.slug === r.form_slug)?.name ?? r.form_slug}</span>
                    <RunLine run={r} tz={tz} now={now} />
                  </div>
                  {rep ? (
                    <p className="text-small text-fg-muted">
                      seen {num(rep.seen)} · to import {num(rep.toImport)} · already {num(rep.alreadyImported)}
                      {r.mode === 'apply' ? ` · imported ${num(rep.imported)}` : ''} · skipped {num(sumCounts(rep.skipped))} · failed {num(sumCounts(rep.failed))}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}

      <p className="text-small text-fg-muted">
        Import runs in the background in short steps and continues if you leave this page. After an import the deal files
        are rebuilt. Full procedure, spot checks and the API assumptions to verify: docs/M5.md.
      </p>
    </section>
  );
}
