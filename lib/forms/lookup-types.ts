// Shared with client components (lookup.ts itself is server-only).
export interface LookupOption {
  id: string;
  label: string;
}

/** Shows only the last four characters of an ID number. */
export function maskId(id: string): string {
  const s = id.replace(/\s/g, '');
  return s.length <= 4 ? '****' : `${'*'.repeat(s.length - 4)}${s.slice(-4)}`;
}
