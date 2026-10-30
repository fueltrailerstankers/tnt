'use client';

import { createClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { errorCls, fileSize, labelCls } from './styles';
import type { ExistingFile, UploadFn } from './types';

interface Props {
  name: string;
  label: string;
  multi: boolean;
  maxFiles?: number;
  accept?: string;
  existing: ExistingFile[];
  upload: UploadFn;
  supabase: { url: string; anonKey: string };
  error?: string;
  disabled?: boolean;
  required?: boolean;
  /** Called after the list of files changes. */
  onChange?: () => void;
}

type Item =
  | { kind: 'existing'; id: string; name: string; url?: string | null }
  | { kind: 'staged'; path: string; name: string; size: number; type: string; preview?: string }
  | { kind: 'uploading'; key: string; name: string; size: number; preview?: string };

const MAX = 20 * 1024 * 1024;
const DEFAULT_ACCEPT = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx';
const IMAGE_NAME = /\.(png|jpe?g|gif|webp|heic|heif)$/i;

function acceptHint(accept: string): string {
  const img = /image/.test(accept);
  const pdf = /pdf/.test(accept);
  const office = /\.docx?|\.xlsx?/.test(accept);
  const kinds = img && pdf ? (office ? 'PDF, photo or Office file' : 'PDF or photo') : img ? 'Photo (JPG, PNG, HEIC)' : pdf ? 'PDF' : 'File';
  return `${kinds} · up to 20 MB each`;
}

/**
 * Multi-file upload straight to Storage via signed upload URLs (never through the app server).
 * The hidden file.<Field> input carries the JSON list the server verifies on save (type sniffed by content).
 */
export function FileField({ name, label, multi, maxFiles, accept, existing, upload, supabase, error, disabled, required, onChange }: Props) {
  const [items, setItems] = useState<Item[]>(existing.map((f) => ({ kind: 'existing', ...f })));
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const previews = useRef<string[]>([]);
  const client = useMemo(() => createClient(supabase.url, supabase.anonKey, { auth: { persistSession: false } }), [supabase.url, supabase.anonKey]);
  const limit = multi ? (maxFiles ?? 10) : 1;
  const busy = items.some((i) => i.kind === 'uploading');
  const acc = accept ?? DEFAULT_ACCEPT;
  const takesPhotos = /image/.test(acc);
  const id = `file-${name}-input`;
  const hintId = `file-${name}-hint`;
  const errId = `file-${name}-err`;

  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  const value = JSON.stringify(
    items.flatMap<Record<string, unknown>>((i) =>
      i.kind === 'existing' ? [{ kind: 'existing', id: i.id }] : i.kind === 'staged' ? [{ kind: 'staged', path: i.path, name: i.name, size: i.size, type: i.type }] : [],
    ),
  );

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    onChangeRef.current?.();
  }, [value]);

  async function onPick(list: FileList | null) {
    setProblem(null);
    if (!list?.length) return;
    const picked = Array.from(list);
    if (picked.some((f) => f.size > MAX)) return setProblem('Each file must be 20 MB or smaller.');
    const room = multi ? limit - items.length : 1;
    if (picked.length > room) return setProblem(`Upload at most ${limit} file${limit === 1 ? '' : 's'}.`);
    const keys = picked.map((f, i) => `${Date.now()}-${i}-${f.name}`);
    const urls = picked.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined));
    previews.current.push(...urls.filter((u): u is string => !!u));
    setItems((cur) => [...(multi ? cur : []), ...picked.map((f, i) => ({ kind: 'uploading' as const, key: keys[i], name: f.name, size: f.size, preview: urls[i] }))]);
    const res = await upload(name, picked.map((f) => ({ name: f.name, size: f.size, type: f.type || 'application/octet-stream' })));
    if (!res.tickets) {
      setItems((cur) => cur.filter((i) => !(i.kind === 'uploading' && keys.includes(i.key))));
      return setProblem(res.error ?? 'Upload failed. Try again.');
    }
    const results = await Promise.all(
      res.tickets.map(async (t, i) => {
        const { error: e } = await client.storage.from('entry-files').uploadToSignedUrl(t.path, t.token, picked[i], { contentType: picked[i].type || undefined });
        return e ? null : t;
      }),
    );
    setItems((cur) =>
      cur.flatMap<Item>((i) => {
        if (i.kind !== 'uploading') return [i];
        const idx = keys.indexOf(i.key);
        if (idx < 0) return [i];
        const t = results[idx];
        return t ? [{ kind: 'staged' as const, path: t.path, name: t.name, size: t.size, type: t.type, preview: urls[idx] }] : [];
      }),
    );
    if (results.some((r) => !r)) setProblem('Some files did not upload. Try adding them again.');
  }

  const canAdd = !disabled && items.length < limit;
  const shownError = problem ?? error;

  return (
    <div>
      <span className={labelCls} id={`${id}-label`}>
        {label}
        {required ? <span className="ml-0.5 text-danger" aria-hidden="true">*</span> : null}
      </span>

      {items.length ? (
        <ul className="mb-2 space-y-2" aria-label={`${label}: files`}>
          {items.map((i, idx) => {
            const key = i.kind === 'existing' ? i.id : i.kind === 'staged' ? i.path : i.key;
            const thumb = i.kind === 'existing' ? (i.url && IMAGE_NAME.test(i.name) ? i.url : undefined) : i.preview;
            const ext = (i.name.split('.').pop() ?? '').slice(0, 4).toUpperCase() || 'FILE';
            return (
              <li key={key} className="flex items-center gap-3 rounded-sm border border-border bg-surface-2 p-2 pr-2.5">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="size-11 flex-none rounded-xs object-cover" />
                ) : (
                  <span aria-hidden="true" className="flex size-11 flex-none items-center justify-center rounded-xs bg-surface font-mono text-[10px] font-semibold text-fg-muted">
                    {ext}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-fg">
                    {i.kind === 'existing' && i.url ? (
                      <a href={i.url} target="_blank" rel="noreferrer" className="text-fg underline-offset-2 hover:underline">{i.name}</a>
                    ) : (
                      i.name
                    )}
                  </span>
                  <span className="block text-label font-medium tracking-normal text-fg-muted">
                    {i.kind === 'uploading' ? 'uploading…' : i.kind === 'staged' ? `${fileSize(i.size)} · ready` : 'uploaded'}
                  </span>
                  {i.kind === 'uploading' ? (
                    <span className="mt-1 block h-1 overflow-hidden rounded-pill bg-surface" aria-hidden="true">
                      <span className="block h-full w-1/3 animate-pulse rounded-pill bg-accent" />
                    </span>
                  ) : null}
                </span>
                {!disabled && i.kind !== 'uploading' ? (
                  <button
                    type="button"
                    aria-label={`Remove ${i.name}`}
                    onClick={() => setItems((cur) => cur.filter((_, j) => j !== idx))}
                    className="flex size-9 flex-none items-center justify-center rounded-full text-fg-muted hover:bg-surface hover:text-status-red-fg"
                  >
                    <Icon name="close" size={16} strokeWidth={2} />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {canAdd ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <label
            htmlFor={id}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) void onPick(e.dataTransfer.files); }}
            className={`flex min-h-12 flex-1 cursor-pointer items-center gap-3 rounded-sm border-2 border-dashed px-4 py-3 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${
              shownError ? 'border-danger' : over ? 'border-accent bg-accent-soft' : 'border-border-strong bg-surface-2 hover:border-accent'
            } ${busy ? 'pointer-events-none opacity-60' : ''}`}
          >
            <span aria-hidden="true" className="flex size-9 flex-none items-center justify-center rounded-full bg-surface text-fg-muted">
              <Icon name="upload" size={18} strokeWidth={2} />
            </span>
            <span className="min-w-0 text-small text-fg-muted">
              <span className="font-semibold text-fg">Drop {multi ? 'files' : 'a file'}</span> or <span className="font-semibold text-accent-text underline underline-offset-2">browse</span>
              <span id={hintId} className="block text-label font-medium tracking-normal">{acceptHint(acc)}</span>
            </span>
            <input
              id={id}
              type="file"
              aria-labelledby={`${id}-label`}
              aria-describedby={shownError ? `${hintId} ${errId}` : hintId}
              data-testid={`file-${name}`}
              multiple={multi}
              accept={acc}
              disabled={busy}
              onChange={(e) => {
                void onPick(e.currentTarget.files);
                e.currentTarget.value = '';
              }}
              className="sr-only"
            />
          </label>
          {takesPhotos ? (
            <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-pill border border-border-strong bg-surface px-4 text-body font-semibold text-fg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus sm:hidden">
              <Icon name="camera" size={18} />
              Take photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={busy}
                aria-label={`${label}: take a photo`}
                onChange={(e) => {
                  void onPick(e.currentTarget.files);
                  e.currentTarget.value = '';
                }}
                className="sr-only"
              />
            </label>
          ) : null}
        </div>
      ) : null}

      <input type="hidden" name={`file.${name}`} value={value} />
      {busy ? <input type="hidden" name="__uploading" value="1" /> : null}
      {shownError ? <p id={errId} role={problem ? 'alert' : undefined} className={errorCls}>{shownError}</p> : null}
    </div>
  );
}
