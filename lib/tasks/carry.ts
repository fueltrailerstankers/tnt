// One-click transitions from the Tasks list (Mark reviewed, Approve) still go through runAction, the only place
// entries are saved. runAction reads the whole entry from the posted form, so a transition must post the entry's
// current values and keep every existing file and signature. carryFormData builds that form from the stored
// entry and proves it round-trips: readFormData(spec, form) must give back exactly the stored data, or the task
// is refused and the user is sent to the entry page instead. Nothing is ever dropped or rewritten. Pure.
import { inputFields, type FormSpec } from '@/lib/spec/types';
import { readFormData, type EntryData } from '@/lib/spec/values';

export interface CarryFile {
  id: string;
  fieldKey: string;
}

export interface CarriedForm {
  get(name: string): string | null;
  getAll(name: string): string[];
}

export type CarryResult = { ok: true; fd: CarriedForm } | { ok: false; reason: 'shape' | 'files' | 'round-trip' };

/** Stable JSON with sorted object keys, for comparing stored and re-read data. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function carryFormData(spec: FormSpec, data: EntryData, files: readonly CarryFile[]): CarryResult {
  const values = new Map<string, string[]>();
  const put = (k: string, v: string) => values.set(k, [...(values.get(k) ?? []), v]);
  const isStr = (v: unknown): v is string => typeof v === 'string';

  for (const f of inputFields(spec)) {
    const key = `f.${f.name}`;
    const v = data[f.name];
    switch (f.type) {
      case 'text':
      case 'textarea':
      case 'email':
      case 'date':
      case 'lookup':
        if (isStr(v)) put(key, v);
        else if (v !== undefined) return { ok: false, reason: 'shape' };
        break;
      case 'number':
        if (typeof v === 'number' && Number.isFinite(v)) put(key, String(v));
        else if (v !== undefined) return { ok: false, reason: 'shape' };
        break;
      case 'choice':
        if (Array.isArray(v) && v.every(isStr)) v.forEach((x) => put(key, x));
        else if (isStr(v)) put(key, v);
        else if (v !== undefined) return { ok: false, reason: 'shape' };
        break;
      case 'name':
      case 'address':
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          for (const p of f.parts) {
            const pv = (v as Record<string, unknown>)[p];
            if (isStr(pv)) put(`${key}.${p}`, pv);
          }
        } else if (v !== undefined) return { ok: false, reason: 'shape' };
        break;
      case 'section': {
        const rows = data.checklist;
        if (rows === undefined) break;
        if (!Array.isArray(rows)) return { ok: false, reason: 'shape' };
        for (const r of rows as Array<Record<string, unknown>>) {
          if (!r || typeof r.itemNo !== 'number') return { ok: false, reason: 'shape' };
          if (r.fail === true) put(`cl.${r.itemNo}.fail`, 'on');
          if (r.pass === true) put(`cl.${r.itemNo}.pass`, 'on');
          if (isStr(r.comments) && r.comments) put(`cl.${r.itemNo}.comments`, r.comments);
        }
        break;
      }
      case 'file':
        put(`file.${f.name}`, JSON.stringify(files.filter((x) => x.fieldKey === f.name).map((x) => ({ kind: 'existing', id: x.id }))));
        break;
      case 'signature': {
        const mine = files.filter((x) => x.fieldKey === f.name);
        if (mine.length > 1) return { ok: false, reason: 'files' };
        if (mine.length === 1) put(`sig.${f.name}`, `keep:${mine[0].id}`);
        break;
      }
      case 'table':
        break; // read-only panel, nothing stored
    }
  }

  const fd: CarriedForm = {
    get: (k) => values.get(k)?.[0] ?? null,
    getAll: (k) => values.get(k) ?? [],
  };
  const read = readFormData(spec, fd);
  if (Object.keys(read.errors).length) return { ok: false, reason: 'round-trip' };
  if (canonical(read.data) !== canonical(data)) return { ok: false, reason: 'round-trip' };
  return { ok: true, fd };
}
