// Import report: counts per form only. It never holds names, emails, ID numbers, file names or field values:
// the only strings in it are form slugs, Cognito field names (schema, not data) and fixed reason codes.

export type FailReason = 'number_taken' | 'download_failed' | 'file_too_large' | 'upload_failed' | 'write_failed';

export interface FileTally {
  count: number;
  /** Sum of sizes Cognito reports (dry-run) for the entries to import. */
  bytes: number;
  /** Files whose size Cognito did not report (not included in bytes). */
  unknownSize: number;
}

export interface FormReport {
  form: string;
  /** Entry count at kit export (spec.entryCountAtExport); BUILD_PLAN M5 expected counts. */
  expected: number | null;
  seen: number;
  toImport: number;
  alreadyImported: number;
  /** Entries found half-imported by an earlier crashed run (apply finishes them). */
  resumable: number;
  imported: number;
  skipped: Record<string, number>;
  failed: Record<string, number>;
  unknownFields: Record<string, { present: number; withValue: number }>;
  /** "<field>:<issue code>" -> count, e.g. "DATECREATED:invalid_date". Values are kept or dropped as documented. */
  issues: Record<string, number>;
  files: FileTally;
  signatures: FileTally;
  stored: { files: number; bytes: number };
  lookups: { resolved: number; pendingSource: number; unresolved: number };
  stoppedAtLimit: boolean;
  maxNumber: number | null;
  counterSetTo: number | null;
}

export interface ImportReport {
  mode: 'dry-run' | 'apply';
  forms: FormReport[];
  notes: string[];
}

export function emptyFormReport(form: string, expected: number | null): FormReport {
  return {
    form, expected, seen: 0, toImport: 0, alreadyImported: 0, resumable: 0, imported: 0, skipped: {}, failed: {},
    unknownFields: {}, issues: {}, files: { count: 0, bytes: 0, unknownSize: 0 }, signatures: { count: 0, bytes: 0, unknownSize: 0 },
    stored: { files: 0, bytes: 0 }, lookups: { resolved: 0, pendingSource: 0, unresolved: 0 }, stoppedAtLimit: false,
    maxNumber: null, counterSetTo: null,
  };
}

export function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function kv(map: Record<string, number>): string {
  const keys = Object.keys(map).sort();
  return keys.length ? keys.map((k) => `${k}=${map[k]}`).join(', ') : 'none';
}

export function formatReport(r: ImportReport): string {
  const lines: string[] = [`Cognito import (${r.mode})`, ''];
  for (const f of r.forms) {
    const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
    lines.push(`== ${f.form}`);
    lines.push(`  seen in Cognito:   ${f.seen}${f.expected !== null ? ` (expected about ${f.expected})` : ''}${f.stoppedAtLimit ? ' [stopped at --limit]' : ''}`);
    lines.push(`  to import:         ${f.toImport}`);
    lines.push(`  already imported:  ${f.alreadyImported}`);
    if (f.resumable) lines.push(`  resumable:         ${f.resumable} (half-imported by an earlier run)`);
    if (r.mode === 'apply') lines.push(`  imported:          ${f.imported}`);
    lines.push(`  skipped:           ${sum(f.skipped)} (${kv(f.skipped)})`);
    lines.push(`  failed:            ${sum(f.failed)} (${kv(f.failed)})`);
    lines.push(`  files:             ${f.files.count} (${fmtBytes(f.files.bytes)}${f.files.unknownSize ? `, ${f.files.unknownSize} without size` : ''})`);
    lines.push(`  signatures:        ${f.signatures.count} (${fmtBytes(f.signatures.bytes)}${f.signatures.unknownSize ? `, ${f.signatures.unknownSize} without size` : ''})`);
    if (r.mode === 'apply') lines.push(`  stored:            ${f.stored.files} objects (${fmtBytes(f.stored.bytes)})`);
    const lk = f.lookups;
    if (lk.resolved + lk.pendingSource + lk.unresolved) {
      lines.push(`  lookups:           resolved=${lk.resolved}, pending source import=${lk.pendingSource}, unresolved=${lk.unresolved}`);
    }
    const unknown = Object.keys(f.unknownFields).sort();
    lines.push(`  unknown fields:    ${unknown.length ? unknown.map((k) => `${k} (present ${f.unknownFields[k].present}, with value ${f.unknownFields[k].withValue})`).join('; ') : 'none'}`);
    lines.push(`  value issues:      ${kv(f.issues)}`);
    if (f.maxNumber !== null) lines.push(`  max entry number:  ${f.maxNumber}`);
    if (f.counterSetTo !== null) lines.push(`  form counter set:  ${f.counterSetTo}`);
    lines.push('');
  }
  for (const n of r.notes) lines.push(`note: ${n}`);
  return lines.join('\n');
}
