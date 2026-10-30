import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormsCard } from '@/components/home/FormsCard';
import { MyTasksCard } from '@/components/home/MyTasksCard';
import { RecentEntriesCard } from '@/components/home/RecentEntriesCard';
import { SyncByEntityCard } from '@/components/home/SyncByEntityCard';
import { XeroHealthTile } from '@/components/home/XeroHealthTile';
import { xeroHealth } from '@/lib/home/xero-health';
import { buildTasks } from '@/lib/tasks/build';

// Server-rendered Home parts with synthetic data: test ids the e2e suite relies on, accessible names, tokens only.
const NOW = '2026-10-29T12:32:00Z';
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const noRawColours = (markup: string) => {
  const attrs = [...markup.matchAll(/(?:class|style)="([^"]*)"/g)].map((m) => m[1]).join(' ');
  expect(attrs).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(attrs).not.toMatch(/\b(?:bg|text|border)-(?:neutral|gray|red|green|yellow|orange|teal|slate|zinc)-\d{2,3}\b/);
};

describe('Home components', () => {
  it('FormsCard keeps form-row-* and unread-* ids, names the plus links and hides "new" at zero', () => {
    const out = renderToStaticMarkup(h(FormsCard, {
      forms: [
        { slug: 'release-form', label: 'Release Form', icon: 'release', href: '/admin/forms/release-form', unread: 2, newHref: '/admin/forms/release-form/new' },
        { slug: 'trailer-inspection-checklist', label: 'Trailer Inspection', icon: 'inspect', href: '/admin/forms/trailer-inspection-checklist', unread: 0, newHref: null },
      ],
    }));
    expect(out).toContain('data-testid="form-row-release-form"');
    expect(out).toContain('data-testid="unread-release-form"');
    expect(out).toContain('href="/admin/forms/release-form?view=unread"');
    expect(out).toContain('aria-label="New Release Form entry"');
    expect(out).not.toContain('unread-trailer-inspection-checklist');
    expect(out).not.toContain('New Trailer Inspection entry');
    expect(text(out)).toContain('2 new');
    noRawColours(out);
  });

  it('MyTasksCard shows up to five rows with kind chips, and an empty state', () => {
    const rows = buildTasks({
      inspections: Array.from({ length: 7 }, (_, i) => ({
        id: `0000000${i}-0000-4000-8000-000000000000`, number: 200 + i, status: 'Submitted', version: 'v', data: {}, waitingSince: NOW, reviewedBy: null,
      })),
      perms: { review: true, approve: true, storeRoom: true, jobs: true, leads: true },
      now: NOW,
    });
    const out = renderToStaticMarkup(h(MyTasksCard, { rows }));
    expect(out.match(/<li /g)).toHaveLength(5);
    expect(text(out)).toContain('Review Review inspection #200');
    expect(out).toContain('aria-label="Review: Review inspection #200"');
    expect(text(renderToStaticMarkup(h(MyTasksCard, { rows: [] })))).toContain('Nothing needs you right now');
    expect(text(renderToStaticMarkup(h(MyTasksCard, { rows: null })))).toContain('Tasks could not be loaded');
    noRawColours(out);
  });

  it('RecentEntriesCard labels the table, marks unread rows for screen readers, and has an empty row', () => {
    const out = renderToStaticMarkup(h(RecentEntriesCard, {
      rows: [
        { id: 'a', label: 'Deal #512', href: '/admin/forms/deal/entries/512', reference: 'QU-10479', by: 'Pieter Demo', when: 'Yesterday 11:02', status: 'Submitted', statusColor: 'teal', unread: true },
        { id: 'b', label: 'Job Card #977', href: '/admin/forms/job-card/entries/977', reference: 'QU-10471', by: 'Public link', when: '27 Oct 15:48', status: 'Submitted', statusColor: 'teal', unread: false },
      ],
    }));
    expect(out).toContain('aria-labelledby="home-recent-title"');
    expect(out.match(/Unread:/g)).toHaveLength(1);
    expect(text(out)).toContain('Form Reference By When Status');
    expect(text(renderToStaticMarkup(h(RecentEntriesCard, { rows: [] })))).toContain('No entries yet.');
    noRawColours(out);
  });

  it('Xero tile and sync card say their state in words', () => {
    const health = xeroHealth({
      connection: { status: 'connected', expiresAt: '2026-10-29T12:54:00Z' },
      states: [{ entity: 'invoices', last_run_at: '2026-10-29T11:58:00Z', last_ok_at: null, last_error: 'xero 429' }],
      failures: [{ error: 'xero 429' }],
    }, NOW);
    const tile = text(renderToStaticMarkup(h(XeroHealthTile, { health })));
    expect(tile).toBe('Xero sync health 1 failure Last sync 13:58 SAST Token expiry in 22 min · auto-refresh Failures 24 h 1 (429 rate limit)');
    expect(text(renderToStaticMarkup(h(XeroHealthTile, { health: null })))).toContain('Unavailable');
    const sync = text(renderToStaticMarkup(h(SyncByEntityCard, { rows: health.sync })));
    expect(sync).toContain('Invoices Failed 13:58 · 429');
    expect(sync).toContain('Quotes Not synced yet');
  });
});
