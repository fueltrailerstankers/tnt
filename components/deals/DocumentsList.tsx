import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { iconButtonClass } from '@/components/ui/IconButton';
import type { DealDocument } from '@/lib/deal-view/documents';
import { shortDateTime } from '@/lib/ui/time';

/** Stored PDF versions of the linked entries, newest first, each with its sha256 (truncated) and a download link. */
export function DocumentsList({ docs, hidden }: { docs: readonly DealDocument[]; hidden: boolean }) {
  return (
    <Card aria-labelledby="docs-h" className="min-w-0 flex-[1_1_380px]" data-testid="deal-documents">
      <h2 id="docs-h" className="m-0 text-[15px] font-semibold leading-[22px]">Generated documents</h2>
      {hidden ? (
        <p className="m-0 text-small text-fg-muted">Documents need Forms access.</p>
      ) : docs.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 border-t border-border py-2">
              <span aria-hidden="true" className="flex h-[42px] w-9 flex-none items-center justify-center rounded-[7px] border border-border bg-surface-2 text-[10px] font-bold text-fg-muted">PDF</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-body font-medium">{d.title}</span>
                <span className="font-mono text-[12px] leading-4 text-fg-muted">
                  {shortDateTime(d.createdAt)} SAST{d.sha ? <> · sha256 {d.sha}</> : null}
                </span>
              </span>
              <a href={d.href} aria-label={`Download ${d.title}`} className={iconButtonClass('secondary', 36)}>
                <Icon name="download" size={16} strokeWidth={2} />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-small text-fg-muted">No PDFs generated yet.</p>
      )}
    </Card>
  );
}
