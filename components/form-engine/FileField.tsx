'use client';

import { createClient } from '@supabase/supabase-js';
import { useMemo, useState } from 'react';
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
}

type Item =
  | { kind: 'existing'; id: string; name: string; url?: string | null }
  | { kind: 'staged'; path: string; name: string; size: number; type: string }
  | { kind: 'uploading'; key: string; name: string };

const MAX = 20 * 1024 * 1024;

/**
 * Multi-file upload straight to Storage via signed upload URLs (never through the app server).
 * The hidden file.<Field> input carries the JSON list the server verifies on save.
 */
export function FileField({ name, label, multi, maxFiles, accept, existing, upload, supabase, error, disabled }: Props) {
  const [items, setItems] = useState<Item[]>(existing.map((f) => ({ kind: 'existing', ...f })));
  const [problem, setProblem] = useState<string | null>(null);
  const client = useMemo(() => createClient(supabase.url, supabase.anonKey, { auth: { persistSession: false } }), [supabase.url, supabase.anonKey]);
  const limit = multi ? (maxFiles ?? 10) : 1;
  const busy = items.some((i) => i.kind === 'uploading');

  const value = JSON.stringify(
    items.flatMap<Record<string, unknown>>((i) =>
      i.kind === 'existing' ? [{ kind: 'existing', id: i.id }] : i.kind === 'staged' ? [{ kind: 'staged', path: i.path, name: i.name, size: i.size, type: i.type }] : [],
    ),
  );

  async function onPick(list: FileList | null) {
    setProblem(null);
    if (!list?.length) return;
    const picked = Array.from(list);
    if (picked.some((f) => f.size > MAX)) return setProblem('Each file must be 20 MB or smaller.');
    const room = multi ? limit - items.length : 1;
    if (picked.length > room) return setProblem(`Upload at most ${limit} file${limit === 1 ? '' : 's'}.`);
    const keys = picked.map((f, i) => `${Date.now()}-${i}-${f.name}`);
    setItems((cur) => [...(multi ? cur : []), ...picked.map((f, i) => ({ kind: 'uploading' as const, key: keys[i], name: f.name }))]);
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
        return t ? [{ kind: 'staged' as const, path: t.path, name: t.name, size: t.size, type: t.type }] : [];
      }),
    );
    if (results.some((r) => !r)) setProblem('Some files did not upload. Try adding them again.');
  }

  return (
    <div>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <ul className="mb-2 space-y-1">
        {items.map((i, idx) => (
          <li key={i.kind === 'existing' ? i.id : i.kind === 'staged' ? i.path : i.key} className="flex items-center justify-between rounded border bg-white px-2 py-1 text-sm">
            <span className="truncate">
              {i.kind === 'existing' && i.url ? (
                <a href={i.url} target="_blank" rel="noreferrer" className="underline">{i.name}</a>
              ) : (
                i.name
              )}
              {i.kind === 'uploading' ? <span className="ml-2 text-neutral-500">uploading…</span> : null}
            </span>
            {!disabled && i.kind !== 'uploading' ? (
              <button type="button" className="ml-2 text-xs text-red-700 underline" onClick={() => setItems((cur) => cur.filter((_, j) => j !== idx))}>
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {!disabled && items.length < limit ? (
        <input
          type="file"
          aria-label={label}
          data-testid={`file-${name}`}
          multiple={multi}
          accept={accept ?? 'image/*,application/pdf,.doc,.docx,.xls,.xlsx'}
          disabled={busy}
          onChange={(e) => {
            void onPick(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
          className="block w-full text-sm file:mr-3 file:rounded file:border file:bg-neutral-50 file:px-3 file:py-2"
        />
      ) : null}
      <input type="hidden" name={`file.${name}`} value={value} />
      {busy ? <input type="hidden" name="__uploading" value="1" /> : null}
      {problem || error ? <p className="mt-1 text-sm text-red-700">{problem ?? error}</p> : null}
    </div>
  );
}
