// Content blocks: the kit's markdown files (verbatim) and inline HTML snippets from the specs.
// Rendered to a tiny block model shared by the web renderer and the PDF renderer, so the legal text
// is never passed through dangerouslySetInnerHTML and both outputs carry the same words.
import { CONTENT } from './content.generated';
import type { ContentField } from './types';

export interface Span {
  text: string;
  bold: boolean;
  /** M8 rich text: set only when true / present. */
  italic?: boolean;
  /** https: or mailto: only (anything else is dropped by the allow-list). */
  href?: string;
}
export type Block =
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'heading'; spans: Span[] }
  | { kind: 'list'; ordered: boolean; items: Span[][] };

export function contentSource(field: ContentField): string {
  if (field.contentRef) {
    const md = CONTENT[field.contentRef];
    if (md === undefined) throw new Error(`Unknown contentRef ${field.contentRef}`);
    return md;
  }
  return field.html ?? '';
}

/** Markdown subset used by the kit: HTML comments (dropped), paragraphs separated by blank lines, **bold**. */
export type Paragraph = Extract<Block, { kind: 'paragraph' }>;

export function markdownBlocks(md: string): Paragraph[] {
  return md
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map((p) => ({ kind: 'paragraph' as const, spans: boldSpans(p) }));
}

function boldSpans(p: string): Span[] {
  const spans: Span[] = [];
  const parts = p.split('**');
  parts.forEach((text, i) => {
    if (text) spans.push({ text, bold: i % 2 === 1 });
  });
  return spans;
}

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

function decode(s: string): string {
  return s.replace(/&[a-z#0-9]+;/gi, (e) => {
    if (ENTITIES[e]) return ENTITIES[e];
    const n = e.match(/^&#(x[0-9a-f]+|\d+);$/i);
    if (n) {
      const code = n[1][0].toLowerCase() === 'x' ? Number.parseInt(n[1].slice(1), 16) : Number(n[1]);
      if (code > 31 && code < 0x110000 && !(code >= 0xd800 && code <= 0xdfff)) return String.fromCodePoint(code);
    }
    return e;
  });
}

function safeHref(attrs: string): string | undefined {
  const m = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const raw = decode(m ? (m[2] ?? m[3] ?? m[4] ?? '') : '').trim();
  return /^(https:\/\/|mailto:)[^\s"'<>]+$/i.test(raw) ? raw : undefined;
}

/** Collapses whitespace inside a block: one space between words, none at the ends. Drops empty spans. */
function tidy(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const text = s.text.replace(/\s+/g, ' ');
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && /\s$/.test(prev.text) && text.startsWith(' ')) out.push({ ...s, text: text.slice(1) });
    else out.push({ ...s, text });
  }
  if (out.length) {
    out[0] = { ...out[0], text: out[0].text.trimStart() };
    out[out.length - 1] = { ...out[out.length - 1], text: out[out.length - 1].text.trimEnd() };
  }
  return out.filter((s) => s.text);
}

/**
 * Inline HTML from the spec, through an allow-list: paragraphs (p, div, br), headings (h1-h6), bold
 * (strong, b), italic (em, i), links (a href https:/mailto: only) and lists (ul, ol, li). Every other tag is
 * dropped (its text kept); script/style content and comments are removed. The result is the block model,
 * never HTML, so nothing from the spec reaches dangerouslySetInnerHTML. The kit's single-<p> snippets come
 * out exactly as before.
 */
export function htmlBlocks(html: string): Block[] {
  const src = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '');
  const blocks: Block[] = [];
  let spans: Span[] = [];
  let kind: 'paragraph' | 'heading' = 'paragraph';
  let bold = 0;
  let italic = 0;
  let href: string | undefined;
  let list: { ordered: boolean; items: Span[][] } | null = null;
  let item: Span[] | null = null;

  const flush = () => {
    const t = tidy(spans);
    spans = [];
    if (!t.length) return;
    if (item) item.push(...t);
    else blocks.push({ kind, spans: t });
  };
  const endItem = () => {
    flush();
    if (list && item) {
      const t = tidy(item);
      if (t.length) list.items.push(t);
    }
    item = null;
  };
  const endList = () => {
    endItem();
    if (list?.items.length) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
    list = null;
  };

  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)|(<)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m[4] !== undefined || m[5] !== undefined) {
      const text = decode(m[4] ?? m[5]);
      const span: Span = { text, bold: bold > 0 };
      if (italic > 0) span.italic = true;
      if (href) span.href = href;
      spans.push(span);
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'p' || tag === 'div') {
      flush();
      kind = 'paragraph';
    } else if (tag === 'br') {
      flush();
    } else if (/^h[1-6]$/.test(tag)) {
      flush();
      kind = closing ? 'paragraph' : 'heading';
    } else if (tag === 'strong' || tag === 'b') {
      bold = Math.max(0, bold + (closing ? -1 : 1));
    } else if (tag === 'em' || tag === 'i') {
      italic = Math.max(0, italic + (closing ? -1 : 1));
    } else if (tag === 'a') {
      href = closing ? undefined : safeHref(m[3]);
    } else if (tag === 'ul' || tag === 'ol') {
      if (closing) endList();
      else {
        endList();
        flush();
        list = { ordered: tag === 'ol', items: [] };
      }
    } else if (tag === 'li') {
      if (!list) {
        flush();
        list = { ordered: false, items: [] };
      }
      endItem();
      if (!closing) item = [];
    }
  }
  if (list) endList();
  flush();
  return blocks;
}

export function contentBlocks(field: ContentField): Block[] {
  return field.contentRef ? markdownBlocks(contentSource(field)) : htmlBlocks(field.html ?? '');
}
