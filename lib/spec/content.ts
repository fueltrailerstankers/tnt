// Content blocks: the kit's markdown files (verbatim) and inline HTML snippets from the specs.
// Rendered to a tiny block model shared by the web renderer and the PDF renderer, so the legal text
// is never passed through dangerouslySetInnerHTML and both outputs carry the same words.
import { CONTENT } from './content.generated';
import type { ContentField } from './types';

export interface Span {
  text: string;
  bold: boolean;
}
export type Block = { kind: 'paragraph'; spans: Span[] };

export function contentSource(field: ContentField): string {
  if (field.contentRef) {
    const md = CONTENT[field.contentRef];
    if (md === undefined) throw new Error(`Unknown contentRef ${field.contentRef}`);
    return md;
  }
  return field.html ?? '';
}

/** Markdown subset used by the kit: HTML comments (dropped), paragraphs separated by blank lines, **bold**. */
export function markdownBlocks(md: string): Block[] {
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

/** The spec's inline HTML snippets are single <p> blocks. Strip tags and decode the few entities used. */
export function htmlBlocks(html: string): Block[] {
  return html
    .split(/<\/p>/i)
    .map((p) => p.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((text) => ({ kind: 'paragraph' as const, spans: [{ text, bold: false }] }));
}

export function contentBlocks(field: ContentField): Block[] {
  return field.contentRef ? markdownBlocks(contentSource(field)) : htmlBlocks(field.html ?? '');
}
