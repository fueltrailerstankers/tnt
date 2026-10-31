'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { buttonClass } from '@/components/ui/styles';
import type { FileRow } from '@/lib/entry-view/rail';

export type PreviewFn = (fileId: string) => Promise<{ ok: true; url: string } | { ok: false; message: string }>;

const TTL_MS = 60_000;

/**
 * Files and signatures of the entry. Preview asks the server for a 60-second signed link (handoff rule 8) and shows
 * "Signed link · expires in 60 s" with an Open link; after a minute the row goes back to Preview.
 */
export function FilesCard({ files, preview }: { files: FileRow[]; preview: PreviewFn }) {
  return (
    <Card padding="sm" aria-labelledby="entry-files-h">
      <CardHeader id="entry-files-h" title="Files" />
      {files.length ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0" data-testid="files">
          {files.map((f) => <FileItem key={f.id} file={f} preview={preview} />)}
        </ul>
      ) : (
        <p className="m-0 text-small text-fg-muted">No files.</p>
      )}
    </Card>
  );
}

function FileItem({ file, preview }: { file: FileRow; preview: PreviewFn }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const openRef = useRef<HTMLAnchorElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { if (link) openRef.current?.focus(); }, [link]);

  const onPreview = async () => {
    setPending(true);
    setError(null);
    try {
      const r = await preview(file.id);
      if (r.ok) {
        setLink(r.url);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setLink(null), TTL_MS);
      } else setError(r.message);
    } catch {
      setError('Could not create a preview link. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <li className="flex items-center gap-2.5">
      <span aria-hidden="true" className="flex size-[34px] flex-none items-center justify-center rounded-sm border border-border bg-surface-2 text-[9px] font-bold text-fg-muted">
        {file.ext}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-small font-medium text-fg" title={file.name}>{file.name}</span>
        {error ? (
          <span role="alert" className="text-[12px] leading-4 text-status-red-fg">{error}</span>
        ) : link ? (
          <span role="status" className="text-[12px] leading-4 text-accent-text">Signed link · expires in 60 s</span>
        ) : (
          <span className="text-[12px] leading-4 text-fg-muted">{file.meta}</span>
        )}
      </span>
      {link ? (
        <a ref={openRef} href={link} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 30, 'flex-none')} aria-label={`Open ${file.name} (signed link, new tab)`}>
          Open
        </a>
      ) : (
        <Button variant="secondary" size={30} className="flex-none" onClick={onPreview} loading={pending} aria-label={`Preview ${file.name}`}>
          Preview
        </Button>
      )}
    </li>
  );
}
