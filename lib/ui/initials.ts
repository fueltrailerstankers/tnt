// Avatar initials. Pure, so client components (Avatar) and the server shell can share it.

/** First letters of the first and last name ("Inspector A. Demo" -> "ID"); `fallback`'s first two letters when there is no name. */
export function initials(name: string | null | undefined, fallback: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback.slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
