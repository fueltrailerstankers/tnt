// Saved views: the lists that support them, the query keys each list may store, input schemas and hrefs. Pure.
// A saved view stores list query parameters only (view, status, search, dates, columns), never entry values.
// Each list page still parses its own URL (parseGridQuery, oneOf, searchTerm), so a stored value is only ever
// a suggestion that the page validates again when the view is opened.
import { z } from 'zod';
import { LEAD_STATUSES } from '@/lib/leads/schema';
import type { Permission } from '@/lib/security/can';

export const VIEW_NAME_MAX = 60;
export const VIEWS_PER_LIST_MAX = 50;
/** Across all lists of one org (the database enforces both caps; 0015 saved_views_limit). */
export const VIEWS_PER_USER_MAX = 500;

/** Lists other than forms. A form's entries grid is `form:<slug>`. */
export const LIST_SCOPES = ['xero_quotes', 'xero_invoices', 'leads'] as const;
export type ListScope = (typeof LIST_SCOPES)[number];
export type ViewScope = `form:${string}` | ListScope;

const FORM_SCOPE = /^form:([a-z0-9][a-z0-9_-]{0,63})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /\p{Cc}/u;

export type ParsedScope = { kind: 'form'; slug: string } | { kind: ListScope };

export function parseScope(scope: string): ParsedScope | null {
  const m = FORM_SCOPE.exec(scope);
  if (m) return { kind: 'form', slug: m[1] };
  return (LIST_SCOPES as readonly string[]).includes(scope) ? { kind: scope as ListScope } : null;
}

export function formScope(slug: string): ViewScope {
  return `form:${slug}`;
}

/** Permission needed to list, save or delete views of a list (the same one its page requires). */
export function scopePermission(scope: ViewScope): Permission {
  const p = parseScope(scope);
  if (!p) throw new Error('unknown saved-view scope');
  return p.kind === 'form' ? 'entries.read' : p.kind === 'leads' ? 'leads.read' : 'xero.read';
}

/** Staff route of a list. */
export function scopePath(scope: ViewScope): string {
  const p = parseScope(scope);
  if (!p) throw new Error('unknown saved-view scope');
  switch (p.kind) {
    case 'form': return `/admin/forms/${p.slug}`;
    case 'xero_quotes': return '/admin/xero/quotes';
    case 'xero_invoices': return '/admin/xero/invoices';
    case 'leads': return '/admin/leads';
  }
}

// ---------------------------------------------------------------------------
// Query whitelists. Every key is optional; empty values are dropped. Paging is never stored.
// ---------------------------------------------------------------------------
const isRealDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Optional free text: trimmed, bounded, no control characters; '' becomes absent. */
const text = (max: number) => z.string().trim().max(max).refine((s) => !CONTROL.test(s), 'Remove control characters')
  .transform((s) => s || undefined).optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate, 'Enter a valid date').optional();
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

const QUERY_SHAPES = {
  form: {
    // 'tasks' is accepted for the planned Awaiting approval view; parseGridQuery falls back to all entries if unknown.
    view: z.union([
      z.enum(['all', 'unread', 'tasks']),
      z.string().regex(/^status:[^\p{Cc}]{1,60}$/u),
    ]).transform((v) => (v === 'all' ? undefined : v)).optional(),
    q: text(100),
    from: date,
    to: date,
    cols: z.array(z.string().regex(FIELD_NAME)).max(12).transform((c) => (c.length ? [...new Set(c)] : undefined)).optional(),
  },
  xero_quotes: {
    q: text(60),
    status: z.string().regex(/^[A-Z_]{1,20}$/).optional(),
  },
  xero_invoices: {
    q: text(60),
    status: z.string().regex(/^[A-Z_]{1,20}$/).optional(),
    type: z.enum(['ACCREC', 'ACCPAY', 'ALL']).transform((t) => (t === 'ACCREC' ? undefined : t)).optional(),
  },
  leads: {
    q: text(60),
    status: z.enum(LEAD_STATUSES).optional(),
    source: z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/).optional(),
    branch: text(60),
    assigned: z.string().refine((s) => s === 'me' || s === 'none' || UUID.test(s), 'Unknown assignee').optional(),
    dups: z.literal('1').optional(),
  },
} satisfies Record<ParsedScope['kind'], Record<string, z.ZodType>>;

/** Stored query: string values, `cols` is a list. Keys depend on the list. */
export type ViewQuery = Record<string, string | string[]>;

const compact = (o: Record<string, unknown>): ViewQuery =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as ViewQuery;

/** A list's keys; an empty string (an empty GET form field) counts as absent for every key. */
const shapeOf = (scope: ViewScope): Record<string, z.ZodType> => {
  const p = parseScope(scope);
  if (!p) throw new Error('unknown saved-view scope');
  return Object.fromEntries(Object.entries(QUERY_SHAPES[p.kind] as Record<string, z.ZodType>)
    .map(([k, s]) => [k, z.preprocess((v) => (v === '' ? undefined : v), s)]));
};

/** Strict schema for a list's stored query: unknown keys or bad values are rejected. */
export function viewQuerySchema(scope: ViewScope): z.ZodType<ViewQuery> {
  return z.object(shapeOf(scope)).strict().transform(compact) as unknown as z.ZodType<ViewQuery>;
}

/**
 * Picks the storable keys from a list page's URL search params, the way the page reads them: the first value
 * of each key (cols: every value, or a comma list), invalid values dropped. Paging and unknown keys are ignored.
 */
export function viewQueryFromParams(scope: ViewScope, params: Record<string, string | string[] | undefined>): ViewQuery {
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(shapeOf(scope))) {
    const raw = params[key];
    if (raw === undefined) continue;
    const value = key === 'cols'
      ? (Array.isArray(raw) ? raw : raw.split(',')).map((c) => c.trim()).filter((c) => FIELD_NAME.test(c)).slice(0, 12)
      : (Array.isArray(raw) ? raw[0] : raw);
    const r = schema.safeParse(value);
    if (r.success) out[key] = r.data;
  }
  return compact(out);
}

/** URL of a list with a stored query applied. Key order follows the whitelist, so hrefs are stable. */
export function viewHref(scope: ViewScope, query: ViewQuery): string {
  const u = new URLSearchParams();
  for (const key of Object.keys(shapeOf(scope))) {
    const v = query[key];
    if (Array.isArray(v)) v.forEach((x) => u.append(key, x));
    else if (typeof v === 'string' && v) u.set(key, v);
  }
  const qs = u.toString();
  return `${scopePath(scope)}${qs ? `?${qs}` : ''}`;
}

// ---------------------------------------------------------------------------
// Input schemas for the server helpers (lib/views/saved-views.ts) and the Save view form.
// ---------------------------------------------------------------------------
export const viewScope = z.string().refine((s) => parseScope(s) !== null, 'Unknown list') as unknown as z.ZodType<ViewScope>;

/** Name: whitespace collapsed, 1..60 characters (code points, as the database counts), no control characters. */
export const viewName = z.string().transform((s) => s.replace(/\s+/g, ' ').trim()).pipe(
  z.string()
    .min(1, 'Enter a name for the view')
    .refine((s) => [...s].length <= VIEW_NAME_MAX, `Use ${VIEW_NAME_MAX} characters or fewer`)
    .refine((s) => !CONTROL.test(s), 'Remove control characters'),
);

const viewId = z.string().regex(UUID, 'Unknown view');
const UNSAVABLE = 'This view has filters that cannot be saved';

export const SavedViewCreate = z.object({ scope: viewScope, name: viewName, query: z.unknown().optional() }).strict()
  .transform((v, ctx) => {
    const q = viewQuerySchema(v.scope).safeParse(v.query ?? {});
    if (!q.success) {
      ctx.addIssue({ code: 'custom', message: UNSAVABLE, path: ['query'] });
      return z.NEVER;
    }
    return { scope: v.scope, name: v.name, query: q.data };
  });
export type SavedViewCreateInput = z.output<typeof SavedViewCreate>;

/** Rename a view and/or replace its query. The scope is required: a view never moves to another list. */
export const SavedViewUpdate = z.object({ id: viewId, scope: viewScope, name: viewName.optional(), query: z.unknown().optional() }).strict()
  .refine((v) => v.name !== undefined || v.query !== undefined, 'Nothing to change')
  .transform((v, ctx) => {
    let query: ViewQuery | undefined;
    if (v.query !== undefined) {
      const q = viewQuerySchema(v.scope).safeParse(v.query);
      if (!q.success) {
        ctx.addIssue({ code: 'custom', message: UNSAVABLE, path: ['query'] });
        return z.NEVER;
      }
      query = q.data;
    }
    return { id: v.id, scope: v.scope, name: v.name, query };
  });
export type SavedViewUpdateInput = z.output<typeof SavedViewUpdate>;

export const SavedViewDelete = z.object({ id: viewId, scope: viewScope }).strict();
export type SavedViewDeleteInput = z.output<typeof SavedViewDelete>;
