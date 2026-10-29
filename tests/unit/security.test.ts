import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, decryptJson, encrypt, encryptJson, parseKey, sha256Hex } from '@/lib/security/crypto';
import { displayFileName, isAllowed, safeObjectName, sniff, storedContentType } from '@/lib/security/files';

const key = randomBytes(32);

describe('AES-256-GCM', () => {
  it('round-trips and is bound to its AAD', () => {
    const env = encrypt(Buffer.from('hello'), key, 'entry-1');
    expect(decrypt(env, key, 'entry-1').toString()).toBe('hello');
    expect(() => decrypt(env, key, 'entry-2')).toThrow();
  });

  it('detects tampering', () => {
    const env = encrypt(Buffer.from('hello'), key);
    env[env.length - 1] ^= 1;
    expect(() => decrypt(env, key)).toThrow();
  });

  it('JSON helpers use Postgres bytea hex', () => {
    const b = encryptJson({ a: 1 }, key, 'id');
    expect(b.startsWith('\\x')).toBe(true);
    expect(decryptJson(b, key, 'id')).toEqual({ a: 1 });
  });

  it('keys must be 32 bytes', () => {
    expect(() => parseKey(undefined, 'K')).toThrow(/not set/);
    expect(() => parseKey(Buffer.alloc(16).toString('base64'), 'K')).toThrow(/32 bytes/);
    expect(parseKey(key.toString('base64'), 'K')).toEqual(key);
  });

  it('sha256', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('file sniffing', () => {
  const bytes = (...b: number[]) => Uint8Array.from([...b, ...new Array(16).fill(0)]);
  it('recognises allowed types by magic bytes, not by name', () => {
    expect(sniff(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe('application/pdf');
    expect(sniff(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniff(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniff(bytes(0x4d, 0x5a))).toBeNull(); // Windows executable
    expect(sniff(new TextEncoder().encode('<html><script>'))).toBeNull();
  });

  it('accept=image/* allows images only', () => {
    expect(isAllowed('image/png', 'image/*')).toBe(true);
    expect(isAllowed('application/pdf', 'image/*')).toBe(false);
    expect(isAllowed(null)).toBe(false);
  });

  it('office documents keep their declared type', () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    expect(storedContentType('application/zip', docx)).toBe(docx);
    expect(storedContentType('application/zip', 'text/html')).toBe('application/zip');
    expect(storedContentType('image/png', 'text/html')).toBe('image/png');
  });

  it('object names are safe; display names lose paths and control chars', () => {
    expect(safeObjectName('../../etc/passwd')).toBe('passwd');
    expect(safeObjectName('Proof of payment (1).PDF')).toBe('Proof-of-payment-1.pdf');
    expect(displayFileName('C:\\Users\\x\\proof\u0000.pdf')).toBe('proof.pdf');
  });
});
