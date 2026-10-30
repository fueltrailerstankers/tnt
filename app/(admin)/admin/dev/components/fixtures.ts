// Fictional fixtures for the component gallery only. No real people, customers, VINs, IDs or emails.

import type { EntryEventRow } from '@/lib/ui/timeline';

export const GALLERY_ACTION = 'createInvoiceFromQuote';

/** Fixed "now" so Today / Yesterday labels do not depend on the day the page is opened. */
export const GALLERY_NOW = '2026-10-29T10:00:00Z';

/**
 * Example USD-per-ZAR rate used ONLY to show the "≈ USD" line in this gallery. It is not a real or current rate.
 * There is no FX source yet; real pages pass a rate from a real source or none, and the line stays hidden.
 */
export const GALLERY_ONLY_FX_RATE = 0.05434;

export const GALLERY_ID_VALUE = 'SAMPLE-ID-0087';

export interface DemoRow {
  number: number;
  vin: string;
  inspector: string;
  submittedAt: string;
  status: string;
  unread: boolean;
}

export const DEMO_ROWS: DemoRow[] = [
  { number: 214, vin: 'TT9DEMO24D0010482', inspector: 'Inspector A. Demo', submittedAt: '2026-10-29T07:14:00Z', status: 'Submitted', unread: true },
  { number: 213, vin: 'TT9DEMO24D0010477', inspector: 'Inspector B. Sample', submittedAt: '2026-10-28T13:40:00Z', status: 'Approved', unread: false },
  { number: 212, vin: 'TT9DEMO24D0010471', inspector: 'Inspector A. Demo', submittedAt: '2026-10-28T06:05:00Z', status: 'Reviewed', unread: true },
  { number: 211, vin: 'TT9DEMO24D0010468', inspector: 'Inspector C. Example', submittedAt: '2026-10-27T13:40:00Z', status: 'Submitted', unread: false },
  { number: 210, vin: 'TT9DEMO24D0010460', inspector: 'Inspector B. Sample', submittedAt: '2026-10-26T09:22:00Z', status: 'Changes requested', unread: false },
  { number: 209, vin: 'TT9DEMO24D0010455', inspector: 'Inspector C. Example', submittedAt: '2026-10-24T11:02:00Z', status: 'Approved', unread: false },
  { number: 208, vin: 'TT9DEMO24D0010449', inspector: 'Inspector A. Demo', submittedAt: '2026-10-23T08:30:00Z', status: 'Incomplete', unread: false },
  { number: 207, vin: 'TT9DEMO24D0010441', inspector: 'Inspector B. Sample', submittedAt: '2026-10-22T14:45:00Z', status: 'Submitted', unread: true },
];

export const TIMELINE_ROWS: EntryEventRow[] = [
  { id: 'e5', action: 'Approve', from_status: 'Reviewed', to_status: 'Approved', actor_user: 'u-admin', actor_role: 'admin', diff: { changed: [] }, created_at: '2026-10-29T07:14:00Z' },
  { id: 'e4', action: 'Mark Reviewed', from_status: 'Submitted', to_status: 'Reviewed', actor_user: 'u-rev', actor_role: 'reviewer', diff: { changed: ['review_notes'] }, created_at: '2026-10-28T14:30:00Z' },
  { id: 'e3', action: 'Email Link', from_status: 'Submitted', to_status: 'Submitted', actor_user: null, actor_role: 'System', diff: { changed: [] }, created_at: '2026-10-28T09:05:00Z' },
  { id: 'e2', action: 'Edit', from_status: 'Submitted', to_status: 'Submitted', actor_user: 'u-insp', actor_role: 'inspector', diff: { changed: ['vin', 'side_markers'] }, created_at: '2026-10-28T09:02:00Z' },
  { id: 'e1', action: 'Submit', from_status: null, to_status: 'Submitted', actor_user: 'u-insp', actor_role: 'inspector', diff: { changed: [] }, created_at: '2026-10-27T13:40:00Z' },
];

export const TIMELINE_NAMES: Record<string, string> = {
  'u-admin': 'Admin A. Demo',
  'u-rev': 'Reviewer B. Sample',
  'u-insp': 'Inspector A. Demo',
};

export const TIMELINE_LABELS: Record<string, string> = { vin: 'VIN', side_markers: 'Side markers', review_notes: 'Review notes' };

export const QUOTE_LINES = [
  { description: 'TT-45K Fuel tanker 45 000 L', amount: 412000 },
  { description: 'Bottom-loading kit', amount: 74750 },
];

/** Statuses shown as filter chips in the gallery table. */
export const DEMO_STATUSES = ['Submitted', 'Reviewed', 'Approved', 'Changes requested', 'Incomplete'] as const;

export const GALLERY_PAGE_SIZE = 4;

export const GALLERY_PATH = '/admin/dev/components';

export interface GalleryQuery {
  status: string;
  page: number;
  row: number | null;
}

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '');

/** Reads the gallery's URL state. Unknown values fall back to defaults. */
export function parseGalleryQuery(sp: Record<string, string | string[] | undefined>): GalleryQuery {
  const status = first(sp.status);
  const page = Number.parseInt(first(sp.page), 10);
  const row = Number.parseInt(first(sp.row), 10);
  return {
    status: (DEMO_STATUSES as readonly string[]).includes(status) ? status : 'all',
    page: Number.isFinite(page) && page > 0 ? page : 1,
    row: DEMO_ROWS.some((r) => r.number === row) ? row : null,
  };
}

/** Gallery URL with the given state; defaults are left out so links stay short. */
export function galleryHref(q: Partial<GalleryQuery>, hash = ''): string {
  const p = new URLSearchParams();
  if (q.status && q.status !== 'all') p.set('status', q.status);
  if (q.page && q.page > 1) p.set('page', String(q.page));
  if (q.row) p.set('row', String(q.row));
  const s = p.toString();
  return `${GALLERY_PATH}${s ? `?${s}` : ''}${hash}`;
}
