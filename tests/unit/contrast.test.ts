import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// WCAG AA contrast for the token pairs the UI relies on, read from app/globals.css so a token change is checked.

const css = readFileSync(path.resolve(import.meta.dirname, '../../app/globals.css'), 'utf8');

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9]+):\s*(#[0-9A-Fa-f]{6})/g)) out[m[1]] = m[2];
  return out;
}

const light = tokens(css.slice(css.indexOf(':root {'), css.indexOf('[data-theme="dark"] {')));
const darkBlock = css.slice(css.indexOf('[data-theme="dark"] {'));
const dark = { ...light, ...tokens(darkBlock.slice(0, darkBlock.indexOf('}'))) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: Array<[fg: string, bg: string]> = [
  ['onaccent', 'accent'],
  ['accenttext', 'surface'],
  ['accenttext', 'bg'],
  ['text', 'surface'],
  ['muted', 'surface'],
  ['muted', 'surface2'],
  ['subtle', 'surface'],
  ['sidetext', 'side'],
  ['sidemuted', 'side'],
  ['sidetext', 'sideactive'],
  ['grayt', 'grayb'],
  ['tealt', 'tealb'],
  ['yelt', 'yelb'],
  ['grnt', 'grnb'],
  ['redt', 'redb'],
  ['redt', 'surface'],
];

describe.each([['light', light], ['dark', dark]] as const)('%s theme', (_name, t) => {
  it('has every token the pairs need', () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      expect(t[fg], fg).toMatch(/^#/);
      expect(t[bg], bg).toMatch(/^#/);
    }
  });

  it.each(TEXT_PAIRS)('%s on %s meets 4.5:1', (fg, bg) => {
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it('white on the red badge meets 4.5:1', () => {
    expect(ratio('#FFFFFF', t.red)).toBeGreaterThanOrEqual(4.5);
  });
});

it('white on the light accent fails AA, which is why text on orange is near-black', () => {
  expect(ratio('#FFFFFF', light.accent)).toBeLessThan(4.5);
});
