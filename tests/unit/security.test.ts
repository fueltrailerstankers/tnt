import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, decryptJson, encrypt, encryptJson, parseKey, sha256Hex } from '@/lib/security/crypto';
import { displayFileName, isAllowed, safeObjectName, safeSignatureSvg, sniff, storedContentType } from '@/lib/security/files';

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
  });});

describe('safeSignatureSvg', () => {
  const svg = (s: string) => safeSignatureSvg(new TextEncoder().encode(s));
  const NS = "xmlns='http://www.w3.org/2000/svg'";

  it('accepts plain drawing markup with an svg root', () => {
    expect(svg(`<svg ${NS}><path d='M0 0L1 1'/></svg>`)).toBe(true);
    expect(svg(`<svg ${NS}/>`)).toBe(true);
    expect(svg(`\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<!-- signature -->\n<svg ${NS} viewBox="0 0 300 100" width="300" height="100"><g fill="none" stroke="#000" stroke-width="2"><polyline points="1,1 2,2"/><circle cx="1" cy="1" r="1"/></g></svg>`)).toBe(true);
  });

  it('refuses anything that is not an svg root or not UTF-8 text', () => {
    expect(svg('<html><body/></html>')).toBe(false);
    expect(svg(`<svgx ${NS}/>`)).toBe(false);
    expect(svg(`<SVG ${NS}/>`)).toBe(false);
    expect(svg(`text<svg ${NS}/>`)).toBe(false);
    expect(svg(`<?xml-stylesheet type="text/css" ?><svg ${NS}/>`)).toBe(false);
    expect(safeSignatureSvg(Uint8Array.from([0x3c, 0x73, 0x76, 0x67, 0x20, 0xff, 0xfe, 0x2f, 0x3e]))).toBe(false);
    expect(svg(`<svg ${NS}>\u0000</svg>`)).toBe(false);
    expect(safeSignatureSvg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });

  it.each([
    ['script', `<svg ${NS}><script>go()</script></svg>`],
    ['prefixed script', `<svg ${NS} xmlns:s='http://www.w3.org/2000/svg'><s:script>go()</s:script></svg>`],
    ['foreignObject', `<svg ${NS}><foreignObject><div/></foreignObject></svg>`],
    ['on* attribute', `<svg ${NS} onload='go()'/>`],
    ['on* attribute, spaced', `<svg ${NS}><path d='M0 0' onclick = 'go()'/></svg>`],
    ['href', `<svg ${NS}><a href='https://example.invalid/'><path d='M0 0'/></a></svg>`],
    ['xlink:href', `<svg ${NS} xmlns:xlink='http://www.w3.org/1999/xlink'><use xlink:href='#a'/></svg>`],
    ['DOCTYPE', `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg ${NS}/>`],
    ['ENTITY', `<svg ${NS}><!ENTITY x "y"></svg>`],
    ['url()', `<svg ${NS}><path d='M0 0' fill='url(https://example.invalid/x)'/></svg>`],
    ['url() in style', `<svg ${NS} style='background: URL ( "https://example.invalid/x" )'/>`],
    ['@import', `<svg ${NS}><style>@import "https://example.invalid/x.css";</style></svg>`],
    ['style element', `<svg ${NS}><style>path { fill: red }</style></svg>`],
    ['character reference', `<svg ${NS} style='fill: u&#114;l(x)'/>`],
    ['image element', `<svg ${NS}><image width='1' height='1'/></svg>`],
    ['animation', `<svg ${NS}><set attributeName='fill' to='red'/></svg>`],
  ])('refuses %s', (_name, markup) => {
    expect(svg(markup)).toBe(false);
  });
});
