// Best-effort fixed-window rate limiter for public endpoints (form submit, upload tickets, lookups).
// In-memory per server instance: it slows down abuse from one client, it is not a global quota.
// Turnstile on public forms is the stronger control (planned with the M5 hardening).
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    }
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

export function clientIp(h: { get(name: string): string | null }): string {
  return (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
}
