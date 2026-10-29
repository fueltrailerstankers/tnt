// Upload safety: content-type sniffing from magic bytes, allow list, safe storage names. Pure.

export type Sniffed = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'image/heic' | 'application/zip';

const ALLOWED: Record<Sniffed, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  // .docx / .xlsx are zip containers; payment proofs and IDs arrive as these sometimes.
  'application/zip': 'zip',
};

function startsWith(b: Uint8Array, sig: number[], offset = 0): boolean {
  return sig.every((x, i) => b[offset + i] === x);
}

export function sniff(head: Uint8Array): Sniffed | null {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (startsWith(head, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...head.slice(8, 12));
    if (['heic', 'heix', 'mif1', 'msf1', 'heis', 'hevc'].includes(brand)) return 'image/heic';
  }
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip';
  return null;
}

export function isAllowed(t: Sniffed | null, accept?: string): boolean {
  if (!t || !(t in ALLOWED)) return false;
  if (accept === 'image/*') return t.startsWith('image/');
  return true;
}

/** Content type to store: the sniffed type, except zip containers keep a declared Office type. */
export function storedContentType(t: Sniffed, declared: string): string {
  if (t === 'application/zip' && /^application\/vnd\.openxmlformats-officedocument\./.test(declared)) return declared;
  return t;
}

/** Storage object name segment: ASCII, no path characters, bounded length. The original name is kept in entry_files only. */
export function safeObjectName(raw: string): string {
  const name = displayFileName(raw);
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : '';
  const base = (dot > 0 ? name.slice(0, dot) : name).normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'file';
  return ext ? `${base}.${ext}` : base;
}

/** Display name: strip directories and control characters. */
export function displayFileName(name: string): string {
  const n = name.split(/[\\/]/).pop() ?? '';
  return n.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'file';
}

/** Drawing elements a signature needs. Anything else (script, foreignObject, style, use, image, set, animate...) is refused. */
const SVG_SIGNATURE_ELEMENTS = new Set(['svg', 'g', 'path', 'polyline', 'polygon', 'line', 'rect', 'circle', 'ellipse', 'title', 'desc']);
const SVG_NEVER = [
  /<([\w.-]+:)?(script|foreignObject)\b/i,
  /\bon[a-z]+\s*=/i, // event handler attributes
  /href/i, // href and xlink:href (links, external references)
  /<!(ENTITY|DOCTYPE)/i,
  /url\s*\(/i,
  /@import|image-set|javascript:/i,
  /&#/, // character references could spell any of the above inside attribute values
];

/**
 * Whether inline SVG signature markup may be stored as image/svg+xml (so it renders in <img>). Accepts only valid
 * UTF-8 text with an `<svg>` root (after an optional XML declaration and comments), signature drawing elements only,
 * and none of: `<script`, `<foreignObject`, `on*=` attributes, `href`/`xlink:href`, `<!ENTITY`/`<!DOCTYPE`, `url(`,
 * `@import`, `image-set`, `javascript:`, character references. Anything else is stored as application/octet-stream. Pure.
 */
export function safeSignatureSvg(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  if (text.includes('\u0000')) return false;
  const body = text.replace(/^﻿/, '').replace(/^\s*(<\?xml\s[^>]*\?>)?(\s*<!--[\s\S]*?-->)*\s*/, '');
  if (!/^<svg[\s/>]/.test(body)) return false;
  if (SVG_NEVER.some((re) => re.test(text))) return false;
  for (const m of text.matchAll(/<\/?([A-Za-z_][\w.:-]*)/g)) if (!SVG_SIGNATURE_ELEMENTS.has(m[1])) return false;
  return true;
}
