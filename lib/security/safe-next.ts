/** Only same-site /admin paths; blocks open redirects like //evil.example or /\evil. */
export function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value : '';
  return /^\/admin(\/[A-Za-z0-9_\-./]*)?$/.test(next) && !next.includes('//') ? next : '/admin';
}
