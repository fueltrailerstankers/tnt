import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CountBadge } from '@/components/ui/CountBadge';
import { IconButton } from '@/components/ui/IconButton';
import { TD, TH } from '@/components/ui/Table';
import { Timeline } from '@/components/ui/Timeline';
import { Toast } from '@/components/ui/Toast';
import { UnreadDot } from '@/components/ui/UnreadDot';
import { UsdAmount } from '@/components/ui/UsdAmount';
import { ZarAmount } from '@/components/ui/ZarAmount';
import { toastAnnouncement, toastPoliteness } from '@/lib/ui/toast';
import type { TimelineItem } from '@/lib/ui/timeline';

const html = (el: ReturnType<typeof h>) => renderToStaticMarkup(el);
const text = (markup: string) => markup.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

describe('ZarAmount / UsdAmount', () => {
  it('shows ZAR with its badge and no USD line without a rate', () => {
    const out = html(h(ZarAmount, { amount: 486750 }));
    expect(text(out)).toBe('R 486,750.00ZAR');
    expect(out).not.toContain('USD');
  });
  it('adds the muted approximate USD line only for ZAR with a positive rate', () => {
    const out = html(h(ZarAmount, { amount: 486750, fxRate: 0.05434 }));
    expect(text(out)).toContain('approximately USD $26,450.00');
    expect(out).toContain('text-fg-muted');
    expect(html(h(ZarAmount, { amount: 486750, fxRate: 0 }))).not.toContain('USD');
    expect(html(h(ZarAmount, { amount: 1250, currency: 'EUR', fxRate: 0.05 }))).not.toContain('USD');
  });
  it('shows the row currency code instead of ZAR, and a dash without a badge for no amount', () => {
    expect(text(html(h(ZarAmount, { amount: 1250, currency: 'eur' })))).toBe('EUR 1,250.00EUR');
    expect(text(html(h(ZarAmount, { amount: null })))).toBe('—');
  });
  it('formats portal money in USD', () => {
    expect(text(html(h(UsdAmount, { amount: '26450' })))).toBe('$26,450.00');
    expect(text(html(h(UsdAmount, { amount: undefined })))).toBe('—');
  });
});

describe('Toast', () => {
  it('is not a live region by default (ToastProvider announces), and names the tone for screen readers', () => {
    const out = html(h(Toast, { title: 'Inspection approved', body: 'Release form will follow.' }));
    expect(out).not.toContain('role=');
    expect(text(out)).toContain('Success: Inspection approved');
  });
  it('can announce itself: status for success and info, alert for errors', () => {
    expect(html(h(Toast, { title: 'Saved', announce: true }))).toContain('role="status"');
    expect(html(h(Toast, { tone: 'info', title: 'Queued', announce: true }))).toContain('role="status"');
    expect(html(h(Toast, { tone: 'error', title: 'Failed', announce: true }))).toContain('role="alert"');
  });
  it('labels the dismiss button', () => {
    expect(html(h(Toast, { title: 'Saved', onDismiss: () => {} }))).toContain('aria-label="Dismiss"');
  });
  it('announces success and info politely and errors assertively', () => {
    expect(toastPoliteness('success')).toBe('polite');
    expect(toastPoliteness('info')).toBe('polite');
    expect(toastPoliteness('error')).toBe('assertive');
    expect(toastAnnouncement({ title: 'Inspection approved', body: 'Release form follows.' })).toBe('Inspection approved. Release form follows.');
    expect(toastAnnouncement({ title: 'Done!', body: 'All set.' })).toBe('Done! All set.');
    expect(toastAnnouncement({ title: ' Saved ' })).toBe('Saved');
  });
});

describe('Table cells', () => {
  it('gives body rows a 42px cell height (40-44px rows) with no vertical padding', () => {
    const cell = html(h('table', null, h('tbody', null, h('tr', null, h(TD, null, 'x')))));
    expect(cell).toContain('h-[42px]');
    expect(cell).toContain('py-0');
  });
  it('right-aligns numeric cells and uses mono for references', () => {
    const out = html(h('table', null, h('tbody', null, h('tr', null, h(TD, { numeric: true }, '1'), h(TD, { mono: true }, 'QU-10482')))));
    expect(out).toContain('text-right tabular-nums');
    expect(out).toContain('font-mono');
  });
  it('scopes header cells to columns', () => {
    expect(html(h('table', null, h('thead', null, h('tr', null, h(TH, null, '#')))))).toContain('scope="col"');
  });
});

describe('Timeline', () => {
  const items: TimelineItem[] = [
    { id: 'a', who: 'Inspector A. Demo', what: 'submitted the entry', fields: [], at: '2026-10-29T07:14:00Z', tone: 'teal' },
    { id: 'b', who: 'Reviewer B. Sample', what: '', fields: ['VIN'], at: '2026-10-28T13:40:00Z', tone: 'neutral' },
  ];
  it('shows SAST times relative to now and field names only', () => {
    const out = text(html(h(Timeline, { items, now: '2026-10-29T10:00:00Z' })));
    expect(out).toContain('Inspector A. Demo submitted the entry');
    expect(out).toContain('Today 09:14 SAST');
    expect(out).toContain('Yesterday 15:40 SAST');
    expect(out).toContain('changed fields: VIN');
    expect(out).toContain('Values are never stored in the timeline.');
  });
  it('falls back to the table date format without now', () => {
    expect(text(html(h(Timeline, { items: items.slice(0, 1) })))).toContain('29 Oct, 09:14 SAST');
  });
});

describe('small parts', () => {
  it('Button loading disables the button, sets aria-busy and keeps the label', () => {
    const out = html(h(Button, { loading: true }, 'Saving…'));
    expect(out).toContain('disabled=""');
    expect(out).toContain('aria-busy="true"');
    expect(text(out)).toBe('Saving…');
  });
  it('Button keeps type=button by default', () => {
    expect(html(h(Button, null, 'Go'))).toContain('type="button"');
  });
  it('IconButton is named by its label and hides the icon', () => {
    const out = html(h(IconButton, { label: 'Next page', icon: 'chevronRight' }));
    expect(out).toContain('aria-label="Next page"');
    expect(out).toContain('aria-hidden="true"');
  });
  it('markers have names', () => {
    expect(html(h(UnreadDot, null))).toContain('aria-label="Unread"');
    expect(html(h(UnreadDot, { read: true }))).toContain('aria-label="Read"');
    expect(html(h(CountBadge, { count: 120 }))).toContain('aria-label="99+ waiting"');
    expect(html(h(CountBadge, { count: 0 }))).toBe('');
  });
  it('Badge defaults its label per variant', () => {
    expect(text(html(h(Badge, { variant: 'zar' })))).toBe('ZAR');
    expect(text(html(h(Badge, { variant: 'auto' })))).toBe('Auto-created from Xero');
  });
});
