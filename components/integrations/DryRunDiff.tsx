'use client';

import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { inputClass } from '@/components/ui/styles';
import { differenceCount, differencesLabel, diffLines, parseMakeRecording, requestLines, sides, type SideLine } from '@/lib/settings/request-diff';

const LINE: Record<SideLine['kind'], string> = {
  same: '',
  added: 'bg-status-green-bg text-status-green-fg',
  removed: 'bg-status-red-bg text-status-red-fg',
};
const MARK: Record<SideLine['kind'], string> = { same: ' ', added: '+', removed: '-' };
const SR: Record<SideLine['kind'], string> = { same: '', added: 'Only the portal sends: ', removed: 'Only Make.com sent: ' };

function Column({ title, lines, empty }: { title: string; lines: SideLine[] | null; empty?: React.ReactNode }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <h3 id={id} className="m-0 bg-surface-2 px-4 py-2 text-label font-semibold text-fg-muted">{title}</h3>
      {lines ? (
        <div role="region" aria-labelledby={id} tabIndex={0} className="relative max-h-[480px] overflow-auto py-2.5 outline-none focus-visible:outline-2 focus-visible:outline-focus">
          <pre className="m-0 font-mono text-[12px] leading-5">
            {lines.map((l, i) => (
              <span key={i} className={`block whitespace-pre px-4 ${LINE[l.kind]}`}>
                <span aria-hidden="true" className="mr-2 select-none">{MARK[l.kind]}</span>
                {l.kind !== 'same' ? <span className="sr-only">{SR[l.kind]}</span> : null}
                {l.text || ' '}
              </span>
            ))}
          </pre>
        </div>
      ) : empty}
    </div>
  );
}

/**
 * "Portal would send" (one recorded dry run, already redacted) against "Make.com sent" (a recording the admin
 * pastes from Make's execution history; it stays in this browser and is redacted before it is shown). Without a
 * recording the right column says so: nothing is made up.
 */
export function DryRunDiff({ action, requests }: { action: string; requests: unknown[] }) {
  const portalLines = useMemo(() => requestLines(requests as never[]), [requests]);
  const [text, setText] = useState('');
  const [make, setMake] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();

  const view = useMemo(() => {
    if (!make) return { portal: portalLines.map((t) => ({ kind: 'same' as const, text: t })), make: null, count: null };
    const d = diffLines(portalLines, make);
    const s = sides(d);
    return { portal: s.portal, make: s.make, count: differenceCount(d) };
  }, [portalLines, make]);

  const compare = () => {
    const r = parseMakeRecording(text, action);
    if (!r.ok) { setError(r.error); setMake(null); return; }
    setError(null);
    setMake(requestLines(r.requests));
  };

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <div className="border-border lg:border-r">
          <Column title="Portal would send" lines={view.portal} />
        </div>
        <div className="border-t border-border lg:border-t-0">
          <Column
            title="Make.com sent"
            lines={view.make}
            empty={<EmptyState variant="plain" icon="file" title="No Make.com recording loaded" body="The portal does not store what Make.com sent. Paste the requests from the scenario's execution history below to compare them line by line." />}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
        <p aria-live="polite" className="m-0 text-small font-semibold" data-testid="diff-count">
          {view.count === null ? '' : <span className={view.count ? 'text-status-yellow-fg' : 'text-status-green-fg'}>{differencesLabel(view.count)}</span>}
        </p>
        <label htmlFor={inputId} className="text-small font-semibold text-fg">Make.com requests (JSON)</label>
        <p className="m-0 text-small text-fg-muted">
          A request list, one request, or a tt-make-replay/1 file (docs/M3.md). It stays in this browser, is never saved, and personal fields are redacted before they are shown.
        </p>
        <textarea
          id={inputId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`${inputClass} font-mono`}
        />
        {error ? <p id={errorId} role="alert" className="m-0 text-small text-status-red-fg">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size={36} onClick={compare} disabled={!text.trim()}>Compare</Button>
          {make ? <Button variant="ghost" size={36} onClick={() => { setMake(null); setText(''); setError(null); }}>Clear recording</Button> : null}
        </div>
      </div>
    </div>
  );
}
