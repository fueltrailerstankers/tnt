import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IconName } from '@/components/ui/Icon';
import { loadForms, type FormRecord } from '@/lib/forms/forms';
import { can, type Member } from '@/lib/security/can';
import type { EntryData } from '@/lib/spec/values';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { INSPECTION_SLUG, STORE_ROOM_SLUG, STORE_ROOM_TASK_STATUS, type TaskRow } from '@/lib/tasks/build';
import { loadTasks } from '@/lib/tasks/load';
import { memberNames } from '@/lib/tasks/names';
import { homeShowsForms } from '@/lib/ui/nav';
import { statusColor } from '@/lib/workflow/rules';
import { formUi, newEntryHref, PHONE_NEW_ENTRY, sortForHome } from './forms';
import { recentRows, type RecentEntryRow } from './recent';
import { xeroHealth, type SyncStateRow, type XeroHealth } from './xero-health';

export interface HomeForm {
  slug: string;
  label: string;
  icon: IconName;
  href: string;
  unread: number;
  newHref: string | null;
}

export interface HomeData {
  name: string | null;
  show: { entries: boolean; tasks: boolean; xero: boolean };
  /** null: the read failed (tiles show "—"). */
  unread: { total: number; forms: number } | null;
  forms: HomeForm[] | null;
  recent: RecentEntryRow[] | null;
  tasks: { rows: TaskRow[]; failedJobs: number } | null;
  awaiting: { inspections: number; storeRoom: number } | null;
  xero: XeroHealth | null;
  newDealHref: string | null;
  phoneNew: Array<{ slug: string; label: string; icon: IconName; href: string }>;
}

interface Overview { slug: string; unread: number }

type RecentRow = {
  id: string; form_id: string; number: number; status: string; summary: string | null; data: EntryData | null;
  created_at: string; submitted_at: string | null; created_by: string | null;
};

const RECENT = 6;
const soft = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

async function profileName(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await db.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  return (data?.full_name as string | null) ?? null;
}

async function recentEntries(db: SupabaseClient, member: Member, forms: FormRecord[], now: Date): Promise<RecentEntryRow[]> {
  const bySlug = new Map(forms.map((f) => [f.id, f]));
  // data_encrypted is never selected; encrypted forms keep data = {} and only their clear summary is shown.
  const { data, error } = await db.from('entries')
    .select('id, form_id, number, status, summary, data, created_at, submitted_at, created_by')
    .eq('org_id', member.orgId).neq('status', 'Incomplete')
    .order('submitted_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
    .limit(RECENT);
  if (error) throw new Error('entries');
  const rows = (data ?? []) as RecentRow[];
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const anonymous = rows.filter((r) => !r.created_by).map((r) => r.id);
  const [reads, events, names] = await Promise.all([
    db.from('entry_reads').select('entry_id').eq('user_id', member.userId).in('entry_id', ids),
    anonymous.length ? db.from('entry_events').select('id, entry_id, actor_role').in('entry_id', anonymous).order('id', { ascending: true }).limit(200) : null,
    memberNames(member.orgId, rows.map((r) => r.created_by)),
  ]);
  const read = new Set((reads.data ?? []).map((r) => r.entry_id as string));
  const firstRole = new Map<string, string>();
  for (const e of events?.data ?? []) if (!firstRole.has(e.entry_id as string)) firstRole.set(e.entry_id as string, e.actor_role as string);
  return recentRows(
    rows.map((r) => {
      const form = bySlug.get(r.form_id);
      return {
        id: r.id, slug: form?.slug ?? '', formName: form?.spec.name ?? 'Entry', number: r.number, status: r.status,
        statusColor: form ? statusColor(form.spec, r.status) : null, summary: r.summary,
        data: form?.encrypt ? null : r.data, createdAt: r.created_at, submittedAt: r.submitted_at, createdBy: r.created_by,
        firstRole: firstRole.get(r.id) ?? null, read: read.has(r.id),
      };
    }),
    names,
    now,
  );
}

async function awaitingCounts(db: SupabaseClient, forms: FormRecord[]): Promise<{ inspections: number; storeRoom: number }> {
  const insp = forms.find((f) => f.slug === INSPECTION_SLUG);
  const store = forms.find((f) => f.slug === STORE_ROOM_SLUG);
  const [i, s] = await Promise.all([
    insp ? db.from('entries').select('id', { count: 'exact', head: true }).eq('form_id', insp.id).in('status', ['Submitted', 'Reviewed']) : null,
    store ? db.from('entries').select('id', { count: 'exact', head: true }).eq('form_id', store.id).eq('status', STORE_ROOM_TASK_STATUS) : null,
  ]);
  if (i?.error || s?.error) throw new Error('counts');
  return { inspections: i?.count ?? 0, storeRoom: s?.count ?? 0 };
}

/** Connection, sync state and 24 h failures. xero_connections and job_runs are service-role tables: read after the xero.read check, never token columns. */
async function xeroBlock(db: SupabaseClient, orgId: string, now: Date): Promise<XeroHealth> {
  const admin = createAdminClient();
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const [conn, states, runs] = await Promise.all([
    soft(Promise.resolve(admin.from('xero_connections').select('status, expires_at').eq('org_id', orgId)
      .order('connected_at', { ascending: false }).limit(1).maybeSingle())),
    soft(Promise.resolve(db.from('xero_sync_state').select('entity, last_run_at, last_ok_at, last_error').eq('org_id', orgId))),
    soft(Promise.resolve(admin.from('job_runs').select('error').eq('org_id', orgId).like('job', 'xero.%').eq('ok', false)
      .gte('started_at', since).order('started_at', { ascending: false }).limit(100))),
  ]);
  if (!conn || conn.error) throw new Error('xero');
  return xeroHealth({
    connection: conn.data ? { status: conn.data.status as string, expiresAt: (conn.data.expires_at as string | null) ?? null } : null,
    states: states && !states.error ? ((states.data ?? []) as SyncStateRow[]) : null,
    failures: runs && !runs.error ? (runs.data ?? []).map((r) => ({ error: (r.error as string | null) ?? null })) : null,
  }, now);
}

/**
 * Everything the dashboard shows, in one pass. The page has already called requirePerm('admin.access'); each block
 * is gated on its own permission and fails soft (null), so one broken source never breaks the page.
 */
export async function loadHome(member: Member, now: Date): Promise<HomeData> {
  const db = await createClient();
  // Factory staff have admin access but no entries: no forms, entries or counts, whose links would all be forbidden.
  const show = { entries: homeShowsForms(member), tasks: can(member, 'tasks.read'), xero: can(member, 'xero.read') };

  const formsP = show.entries ? soft(loadForms(db, member.orgId)) : Promise.resolve(null);
  const [name, forms, overview, tasks, xero] = await Promise.all([
    soft(profileName(db, member.userId)),
    formsP,
    show.entries ? soft(Promise.resolve(db.rpc('form_overview')).then((r) => {
      if (r.error) throw new Error('form_overview');
      return (r.data ?? []) as Overview[];
    })) : null,
    show.tasks ? soft(loadTasks(member, now, db)) : null,
    show.xero ? soft(xeroBlock(db, member.orgId, now)) : null,
  ]);

  const [recent, awaiting] = forms
    ? await Promise.all([soft(recentEntries(db, member, forms, now)), soft(awaitingCounts(db, forms))])
    : [null, null];

  const unreadBySlug = new Map((overview ?? []).map((o) => [o.slug, Number(o.unread) || 0]));
  const homeForms: HomeForm[] | null = forms
    ? sortForHome(forms).map((f) => {
      const ui = formUi(f.slug, f.spec.name);
      return { slug: f.slug, label: ui.label, icon: ui.icon, href: `/admin/forms/${f.slug}`, unread: unreadBySlug.get(f.slug) ?? 0, newHref: newEntryHref(f, member) };
    })
    : null;

  const deal = forms?.find((f) => f.slug === 'deal');
  const dealHref = deal ? newEntryHref(deal, member) : null;
  const phoneNew = PHONE_NEW_ENTRY.flatMap((slug) => {
    const f = forms?.find((x) => x.slug === slug);
    const href = f ? newEntryHref(f, member) : null;
    const ui = formUi(slug, f?.spec.name ?? slug);
    return f && href ? [{ slug, label: ui.phoneLabel, icon: ui.icon, href }] : [];
  });

  return {
    name,
    show,
    unread: overview ? { total: [...unreadBySlug.values()].reduce((a, b) => a + b, 0), forms: [...unreadBySlug.values()].filter((n) => n > 0).length } : null,
    forms: homeForms,
    recent,
    tasks: tasks ? { rows: tasks.rows, failedJobs: tasks.rows.filter((r) => r.category === 'failed-jobs').length } : null,
    awaiting,
    xero,
    newDealHref: dealHref?.startsWith('/admin/') ? dealHref : null,
    phoneNew,
  };
}
