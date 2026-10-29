// Validation of upload-ticket requests (before any signed URL is issued). Pure.
import { inputFields, type FormSpec } from '@/lib/spec/types';
import { MAX_FILE_BYTES } from '@/lib/spec/values';

export interface UploadMeta {
  name: string;
  size: number;
  type: string;
}

export function validateUploadRequest(spec: FormSpec, field: string, files: unknown): { ok: true; files: UploadMeta[] } | { ok: false; error: string } {
  const f = inputFields(spec).find((x) => x.name === field);
  if (!f || f.type !== 'file') return { ok: false, error: 'Unknown file field.' };
  if (!Array.isArray(files) || files.length === 0) return { ok: false, error: 'No files.' };
  const max = f.multi ? (f.maxFiles ?? 10) : 1;
  if (files.length > max) return { ok: false, error: `Upload at most ${max} file${max === 1 ? '' : 's'}.` };
  const out: UploadMeta[] = [];
  for (const x of files) {
    if (!x || typeof x.name !== 'string' || typeof x.size !== 'number' || typeof x.type !== 'string') return { ok: false, error: 'Invalid file.' };
    if (x.size <= 0 || x.size > MAX_FILE_BYTES) return { ok: false, error: 'Each file must be 20 MB or smaller.' };
    if (f.accept === 'image/*' && !x.type.startsWith('image/')) return { ok: false, error: 'Only images can be added here.' };
    out.push({ name: x.name.slice(0, 255), size: x.size, type: x.type.slice(0, 255) });
  }
  return { ok: true, files: out };
}
