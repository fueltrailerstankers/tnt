// Masks for protected values. Pure. Mask on the SERVER and send only the masked string to a client that may not
// see the clear value; ProtectedField never receives the clear value until an audited reveal action returns it.

export const BULLET = '•';

const bullets = (n: number) => BULLET.repeat(n);

/**
 * ID numbers: a fixed shape with the last two characters, "•••••• •••• •87". The shape does not depend on the
 * value's length, so the mask does not leak it. Values shorter than 6 characters are fully masked.
 */
export function maskId(value: string | null | undefined): string {
  const v = (value ?? '').replace(/\s+/g, '');
  if (!v) return '';
  if (v.length < 6) return bullets(6);
  return `${bullets(6)} ${bullets(4)} ${BULLET}${v.slice(-2)}`;
}

/**
 * Emails keep the first and last character of the local part plus the domain: "i•••••••••a@example.com". The masked
 * local part is always 11 characters, so it does not leak the length; a 1-2 character local part shows less.
 */
export function maskEmail(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  const at = v.lastIndexOf('@');
  if (at < 1 || at === v.length - 1) return bullets(6);
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (local.length === 1) return `${bullets(11)}@${domain}`;
  if (local.length === 2) return `${local[0]}${bullets(10)}@${domain}`;
  return `${local[0]}${bullets(9)}${local[local.length - 1]}@${domain}`;
}

export type MaskKind = 'id' | 'email' | 'text';

/** Mask by kind; plain text hides everything. */
export function maskValue(value: string | null | undefined, kind: MaskKind): string {
  if (kind === 'id') return maskId(value);
  if (kind === 'email') return maskEmail(value);
  return (value ?? '').trim() ? bullets(6) : '';
}
