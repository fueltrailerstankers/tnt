import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { assertPerm, type Member } from '@/lib/security/can';
import {
  SavedViewCreate, SavedViewDelete, SavedViewUpdate, VIEWS_PER_LIST_MAX, VIEWS_PER_USER_MAX,
  scopePermission, viewHref, viewQuerySchema, viewScope,
  type ViewQuery, type ViewScope,
} from './query';

// Saved views CRUD through the caller's RLS client (lib/supabase/server createClient), never the service role.
// Callers (server actions, pages) run requirePerm first; every helper also checks the list's own permission,
// validates its input with Zod, and scopes each query to the caller's org and user id (RLS enforces the same).

export * from './query';

export interface SavedView {
  id: string;
  scope: ViewScope;
  name: string;
  query: ViewQuery;
  href: string;
  createdAt: string;
}

export type SavedViewErrorCode = 'invalid' | 'duplicate' | 'limit' | 'not_found';

/** A user-facing failure; the message is safe to show. */
export class SavedViewError extends Error {
  constructor(readonly code: SavedViewErrorCode, message: string) {
    super(message);
    this.name = 'SavedViewError';
  }
}

const COLUMNS = 'id, scope, name, query, created_at';
interface Row { id: string; scope: string; name: string; query: unknown; created_at: string }

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new SavedViewError('invalid', r.error.issues[0]?.message ?? 'Check the view and try again');
  return r.data;
}

const toView = (r: Row, scope: ViewScope, query: ViewQuery): SavedView =>
  ({ id: r.id, scope, name: r.name, query, href: viewHref(scope, query), createdAt: r.created_at });

const failed = (error: { message: string }): Error => new Error(`saved_views: ${error.message}`);
const DUPLICATE = 'You already have a view with this name.';
const LIMIT = `You can save up to ${VIEWS_PER_LIST_MAX} views per list (${VIEWS_PER_USER_MAX} in all). Delete one first.`;
/** program_limit_exceeded: raised by the saved_views_limit trigger (0015), e.g. when two saves race the cap. */
const LIMIT_CODE = '54000';

/** The caller's own views of one list, by name. Rows whose stored query no longer validates are skipped. */
export async function listSavedViews(userDb: SupabaseClient, member: Member, scope: string): Promise<SavedView[]> {
  const s = parse(viewScope, scope);
  assertPerm(member, scopePermission(s));
  const { data, error } = await userDb.from('saved_views').select(COLUMNS)
    .eq('org_id', member.orgId).eq('user_id', member.userId).eq('scope', s)
    .order('name').limit(VIEWS_PER_LIST_MAX);
  if (error) throw failed(error);
  const schema = viewQuerySchema(s);
  return ((data ?? []) as Row[]).flatMap((r) => {
    const q = schema.safeParse(r.query);
    return q.success ? [toView(r, s, q.data)] : [];
  });
}

/** Saves a new view for the caller. Names are unique per user and list (SavedViewError 'duplicate'). */
export async function createSavedView(userDb: SupabaseClient, member: Member, input: unknown): Promise<SavedView> {
  const v = parse(SavedViewCreate, input);
  assertPerm(member, scopePermission(v.scope));
  const { count, error: countError } = await userDb.from('saved_views').select('id', { count: 'exact', head: true })
    .eq('org_id', member.orgId).eq('user_id', member.userId).eq('scope', v.scope);
  if (countError) throw failed(countError);
  if ((count ?? 0) >= VIEWS_PER_LIST_MAX) throw new SavedViewError('limit', LIMIT);
  const { data, error } = await userDb.from('saved_views')
    .insert({ org_id: member.orgId, user_id: member.userId, scope: v.scope, name: v.name, query: v.query })
    .select(COLUMNS);
  if (error?.code === '23505') throw new SavedViewError('duplicate', DUPLICATE);
  if (error?.code === LIMIT_CODE) throw new SavedViewError('limit', LIMIT);
  if (error) throw failed(error);
  const row = (data as Row[] | null)?.[0];
  if (!row) throw new Error('saved_views: insert returned no row');
  return toView(row, v.scope, v.query);
}

/** Renames a view and/or replaces its query. Only the caller's own view of that list can change. */
export async function updateSavedView(userDb: SupabaseClient, member: Member, input: unknown): Promise<SavedView> {
  const v = parse(SavedViewUpdate, input);
  assertPerm(member, scopePermission(v.scope));
  const patch: { name?: string; query?: ViewQuery } = {};
  if (v.name !== undefined) patch.name = v.name;
  if (v.query !== undefined) patch.query = v.query;
  const { data, error } = await userDb.from('saved_views').update(patch)
    .eq('id', v.id).eq('org_id', member.orgId).eq('user_id', member.userId).eq('scope', v.scope)
    .select(COLUMNS);
  if (error?.code === '23505') throw new SavedViewError('duplicate', DUPLICATE);
  if (error) throw failed(error);
  const row = (data as Row[] | null)?.[0];
  if (!row) throw new SavedViewError('not_found', 'That view no longer exists.');
  const q = viewQuerySchema(v.scope).safeParse(row.query);
  return toView(row, v.scope, q.success ? q.data : {});
}

/** Deletes one of the caller's views. */
export async function deleteSavedView(userDb: SupabaseClient, member: Member, input: unknown): Promise<void> {
  const v = parse(SavedViewDelete, input);
  assertPerm(member, scopePermission(v.scope));
  const { data, error } = await userDb.from('saved_views').delete()
    .eq('id', v.id).eq('org_id', member.orgId).eq('user_id', member.userId).eq('scope', v.scope)
    .select('id');
  if (error) throw failed(error);
  if (!data?.length) throw new SavedViewError('not_found', 'That view no longer exists.');
}
