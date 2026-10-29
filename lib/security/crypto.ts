// AES-256-GCM for encrypted entry data (DEAL, Delivery Note) and, later, secrets and Xero tokens.
// Envelope: 1 version byte | 12-byte IV | 16-byte tag | ciphertext. Keys are 32 bytes, base64 in env.
// Pure apart from node:crypto; keys are passed in so tests never touch real env.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 1;

export function parseKey(b64: string | undefined, name: string): Buffer {
  if (!b64) throw new Error(`${name} is not set`);
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes, base64 encoded`);
  return key;
}

export function encrypt(plain: Buffer, key: Buffer, aad = ''): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, c.getAuthTag(), body]);
}

export function decrypt(envelope: Buffer, key: Buffer, aad = ''): Buffer {
  if (envelope.length < 29 || envelope[0] !== VERSION) throw new Error('Unsupported ciphertext');
  const d = createDecipheriv('aes-256-gcm', key, envelope.subarray(1, 13));
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(envelope.subarray(13, 29));
  return Buffer.concat([d.update(envelope.subarray(29)), d.final()]);
}

/** JSON in, Postgres bytea hex literal out ("\\x..."), bound to the entry id so ciphertext cannot be swapped between rows. */
export function encryptJson(value: unknown, key: Buffer, aad: string): string {
  return `\\x${encrypt(Buffer.from(JSON.stringify(value)), key, aad).toString('hex')}`;
}

export function decryptJson<T = unknown>(bytea: string, key: Buffer, aad: string): T {
  const hex = bytea.startsWith('\\x') ? bytea.slice(2) : bytea;
  return JSON.parse(decrypt(Buffer.from(hex, 'hex'), key, aad).toString('utf8')) as T;
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
