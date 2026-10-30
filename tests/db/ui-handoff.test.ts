import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { as, connect } from './helpers';

vi.mock('server-only', () => ({}));
const { termsSha256 } = await import('@/lib/terms/versions');

// 0015 UI handoff: saved views, terms versions, signature metadata on entry_files. Synthetic data only.
const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_E = '00000000-0000-0000-0000-0000000000e5';
const ADMIN_A = '00000000-0000-0000-0000-00000000a501';
const STAFF_A = '00000000-0000-0000-0000-00000000a502';
const ADMIN_E = '00000000-0000-0000-0000-00000000e501';
const SHA = (c: string) => c.repeat(64);

let db: Client;
let viewA: string;
let termsA: string;
let termsE: string;
let entryA: string;

/** Runs fn as service_role (no JWT), then rolls back. */
async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query('set local role service_role');
    return await fn();
  } finally {
    await db.query('rollback');
  }
}

const count = async (sql: string, params: unknown[] = []) => Number((await db.query(sql, params)).rows[0].n);

/** Inserts a terms version with the sha256 computed by the database over the body; returns its id. */
const insertTerms = async (org: string, key: string, body: string): Promise<string> => (await db.query(
  `insert into public.terms_versions(org_id, key, sha256, body) select $1, $2, public.terms_body_sha256(b), b from (select $3::jsonb as b) x returning id`,
  [org, key, body],
)).rows[0].id;

/** ISO time relative to now, for signed_at values that must not lie after the row's created_at. */
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

beforeAll(async () => {
  db = await connect();
  await db.query(
    `insert into auth.users(id, email) values ($1,'ui-admin-a@example.invalid'), ($2,'ui-staff-a@example.invalid'), ($3,'ui-admin-e@example.invalid') on conflict do nothing`,
    [ADMIN_A, STAFF_A, ADMIN_E],
  );
  await db.query(`insert into public.orgs(id, name) values ($1, 'Org E') on conflict do nothing`, [ORG_E]);
  await db.query(
    `insert into public.memberships(org_id, user_id, role) values ($1,$2,'admin'), ($1,$3,'staff'), ($4,$5,'admin') on conflict do nothing`,
    [ORG_A, ADMIN_A, STAFF_A, ORG_E, ADMIN_E],
  );
  viewA = (await db.query(
    `insert into public.saved_views(org_id, user_id, scope, name, query) values ($1,$2,'form:job-card','Durban branch','{"view":"unread","q":"durban"}') returning id`,
    [ORG_A, ADMIN_A],
  )).rows[0].id;
  termsA = await insertTerms(ORG_A, 'delivery-note', '[{"id":"terms","text":"Synthetic terms A."}]');
  termsE = await insertTerms(ORG_E, 'delivery-note', '[{"id":"terms","text":"Synthetic terms E."}]');
  const form = await db.query(`select id from public.forms where slug = 'delivery-note' and org_id = $1`, [ORG_A]);
  entryA = (await db.query(
    `insert into public.entries(form_id, number, status, summary) values ($1, 0, 'Submitted', 'TT9DEMO24D0010482') returning id`,
    [form.rows[0].id],
  )).rows[0].id;
});

afterAll(async () => { await db.end(); });

describe('saved_views', () => {
  it('the owner reads their own view', async () => {
    const rows = await as(db, 'authenticated', ADMIN_A, async () =>
      (await db.query(`select name, query from public.saved_views where id = $1`, [viewA])).rows);
    expect(rows).toEqual([{ name: 'Durban branch', query: { view: 'unread', q: 'durban' } }]);
  });

  it("another member of the same org cannot read, rename or delete someone else's view", async () => {
    await as(db, 'authenticated', STAFF_A, async () => {
      expect(await count(`select count(*) as n from public.saved_views where id = $1`, [viewA])).toBe(0);
      expect((await db.query(`update public.saved_views set name = 'Taken' where id = $1`, [viewA])).rowCount).toBe(0);
      expect((await db.query(`delete from public.saved_views where id = $1`, [viewA])).rowCount).toBe(0);
    });
    expect((await db.query(`select name from public.saved_views where id = $1`, [viewA])).rows[0].name).toBe('Durban branch');
  });

  it('another org sees nothing, even its admin', async () => {
    const n = await as(db, 'authenticated', ADMIN_E, async () => count(`select count(*) as n from public.saved_views`));
    expect(n).toBe(0);
  });

  it('anon cannot read saved views', async () => {
    await expect(as(db, 'anon', null, () => db.query(`select 1 from public.saved_views`))).rejects.toThrow(/permission denied/);
  });

  it('a member creates, renames and deletes their own view', async () => {
    await as(db, 'authenticated', STAFF_A, async () => {
      const id = (await db.query(
        `insert into public.saved_views(org_id, user_id, scope, name, query) values ($1,$2,'leads','Mine','{"assigned":"me"}') returning id`,
        [ORG_A, STAFF_A],
      )).rows[0].id;
      expect((await db.query(`update public.saved_views set name = 'Assigned to me', query = '{"assigned":"me","status":"new"}' where id = $1`, [id])).rowCount).toBe(1);
      expect((await db.query(`delete from public.saved_views where id = $1`, [id])).rowCount).toBe(1);
    });
  });

  it("a member cannot create a view for another user or in an org they don't belong to", async () => {
    await expect(as(db, 'authenticated', STAFF_A, () =>
      db.query(`insert into public.saved_views(org_id, user_id, scope, name) values ($1,$2,'leads','Spoof')`, [ORG_A, ADMIN_A]),
    )).rejects.toThrow(/row-level security/);
    await expect(as(db, 'authenticated', ADMIN_E, () =>
      db.query(`insert into public.saved_views(org_id, user_id, scope, name) values ($1,$2,'leads','Spoof')`, [ORG_A, ADMIN_E]),
    )).rejects.toThrow(/row-level security/);
  });

  it('a view never moves to another user, org or list (column grants)', async () => {
    for (const set of [`user_id = '${STAFF_A}'`, `org_id = '${ORG_E}'`, `scope = 'leads'`]) {
      await expect(as(db, 'authenticated', ADMIN_A, () =>
        db.query(`update public.saved_views set ${set} where id = $1`, [viewA]))).rejects.toThrow(/permission denied/);
    }
  });

  it('a client cannot choose the id or backdate created_at (insert column grants)', async () => {
    for (const [col, val] of [['id', '00000000-0000-0000-0000-00000000d001'], ['created_at', '2001-01-01T00:00:00Z']]) {
      await expect(as(db, 'authenticated', STAFF_A, () =>
        db.query(`insert into public.saved_views(org_id, user_id, scope, name, ${col}) values ($1,$2,'leads','Backdated',$3)`, [ORG_A, STAFF_A, val]),
      )).rejects.toThrow(/permission denied/);
    }
  });

  it('caps views at 50 per list and 500 per user, even through the API', async () => {
    await as(db, 'authenticated', STAFF_A, async () => {
      await db.query(
        `insert into public.saved_views(org_id, user_id, scope, name) select $1, $2, 'xero_quotes', 'View ' || g from generate_series(1, 50) g`,
        [ORG_A, STAFF_A],
      );
      await expect(db.query(`insert into public.saved_views(org_id, user_id, scope, name) values ($1,$2,'xero_quotes','View 51')`, [ORG_A, STAFF_A]))
        .rejects.toThrow(/limit reached/);
    });
    await as(db, 'authenticated', STAFF_A, async () => {
      // Any form slug is a valid scope format, so the per-user cap is what bounds a member's rows.
      await db.query(
        `insert into public.saved_views(org_id, user_id, scope, name) select $1, $2, 'form:junk-' || g, 'View' from generate_series(1, 500) g`,
        [ORG_A, STAFF_A],
      );
      expect(await count(`select count(*) as n from public.saved_views`)).toBe(500);
      await expect(db.query(`insert into public.saved_views(org_id, user_id, scope, name) values ($1,$2,'leads','One more')`, [ORG_A, STAFF_A]))
        .rejects.toThrow(/limit reached/);
    });
  });

  it('names are unique per user and list; other users may reuse a name', async () => {
    await expect(db.query(
      `insert into public.saved_views(org_id, user_id, scope, name) values ($1,$2,'form:job-card','Durban branch')`, [ORG_A, ADMIN_A],
    )).rejects.toThrow(/duplicate key/);
    await as(db, 'authenticated', STAFF_A, async () => {
      await db.query(`insert into public.saved_views(org_id, user_id, scope, name) values ($1,$2,'form:job-card','Durban branch')`, [ORG_A, STAFF_A]);
    });
  });

  it('checks name, scope and query shape', async () => {
    const ins = (scope: string, name: string, query = '{}') =>
      db.query(`insert into public.saved_views(org_id, user_id, scope, name, query) values ($1,$2,$3,$4,$5::jsonb)`, [ORG_A, ADMIN_A, scope, name, query]);
    for (const [scope, name, query] of [
      ['leads', '', '{}'],
      ['leads', ' Padded', '{}'],
      ['leads', 'x'.repeat(61), '{}'],
      ['leads', 'Tab\there', '{}'],
      ['Leads', 'Bad scope', '{}'],
      ['form:', 'Empty slug', '{}'],
      ['form:Job Card', 'Spaces', '{}'],
      ['leads', 'Array query', '[]'],
      ['leads', 'Big query', JSON.stringify({ q: 'x'.repeat(5000) })],
    ]) {
      await expect(ins(scope, name, query)).rejects.toThrow(/check constraint/);
    }
    await ins('xero_invoices', 'x'.repeat(60), '{"status":"PAID"}');
  });

  it('disappears for a user who leaves the org', async () => {
    const before = await as(db, 'authenticated', ADMIN_A, async () => count(`select count(*) as n from public.saved_views where id = $1`, [viewA]));
    expect(before).toBe(1);
    await db.query('begin');
    try {
      // 0021: the org must keep an active admin, so another member takes over first (rolled back).
      await db.query(`update public.memberships set role = 'admin' where org_id = $1 and user_id = $2`, [ORG_A, STAFF_A]);
      await db.query(`delete from public.memberships where org_id = $1 and user_id = $2`, [ORG_A, ADMIN_A]);
      await db.query(`set local role authenticated`);
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ADMIN_A, role: 'authenticated' })]);
      expect(await count(`select count(*) as n from public.saved_views where id = $1`, [viewA])).toBe(0);
    } finally {
      await db.query('rollback');
    }
  });
});

describe('terms_versions', () => {
  it('members read their own org versions only', async () => {
    const a = await as(db, 'authenticated', STAFF_A, async () =>
      (await db.query(`select id from public.terms_versions where key = 'delivery-note'`)).rows.map((r) => r.id));
    expect(a).toContain(termsA);
    expect(a).not.toContain(termsE);
    const e = await as(db, 'authenticated', ADMIN_E, async () =>
      (await db.query(`select id from public.terms_versions`)).rows.map((r) => r.id));
    expect(e).toEqual([termsE]);
  });

  it('clients cannot insert, update or delete terms versions, even an org admin', async () => {
    for (const sql of [
      `insert into public.terms_versions(org_id, key, sha256, body) values ('${ORG_A}','delivery-note','${SHA('b')}','[{"id":"t","text":"x"}]')`,
      `update public.terms_versions set body = '[{"id":"t","text":"changed"}]' where id = '${termsA}'`,
      `delete from public.terms_versions where id = '${termsA}'`,
    ]) {
      await expect(as(db, 'authenticated', ADMIN_A, () => db.query(sql))).rejects.toThrow(/permission denied/);
    }
    await expect(as(db, 'anon', null, () => db.query(`select 1 from public.terms_versions`))).rejects.toThrow(/permission denied/);
  });

  it('rows cannot be updated, deleted or truncated, even by the owner', async () => {
    await expect(db.query(`update public.terms_versions set key = 'other' where id = $1`, [termsA])).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from public.terms_versions where id = $1`, [termsA])).rejects.toThrow(/append-only/);
    await db.query('begin');
    try {
      await expect(db.query(`truncate public.terms_versions cascade`)).rejects.toThrow(/append-only/);
    } finally {
      await db.query('rollback');
    }
    expect(await count(`select count(*) as n from public.terms_versions where id = $1`, [termsA])).toBe(1);
  });

  it('the service role inserts and reads, and cannot update', async () => {
    await asService(async () => {
      const body = [{ id: 't', text: 'v2' }];
      const r = await db.query(
        `insert into public.terms_versions(org_id, key, sha256, body) values ($1,'delivery-note',$2,$3::jsonb) returning id`,
        [ORG_A, termsSha256(body), JSON.stringify(body)],
      );
      expect(r.rows[0].id).toBeTruthy();
      await expect(db.query(`update public.terms_versions set key = 'x' where id = $1`, [termsA])).rejects.toThrow(/permission denied/);
    });
  });

  it('one row per (org, key, sha256); the same text may exist in another org', async () => {
    const same = '[{"id":"terms","text":"Synthetic terms A."}]';
    await expect(insertTerms(ORG_A, 'delivery-note', same)).rejects.toThrow(/duplicate key/);
    await db.query('begin');
    try {
      await insertTerms(ORG_E, 'delivery-note', same);
    } finally {
      await db.query('rollback');
    }
  });

  it('checks key and body format', async () => {
    const ok = '[{"id":"t","text":"x"}]';
    for (const body of ['[]', '{"id":"t"}', '"text"']) {
      await expect(db.query(`insert into public.terms_versions(org_id, key, sha256, body) values ($1,'delivery-note',$2,$3::jsonb)`, [ORG_A, SHA('f'), body]))
        .rejects.toThrow(/body must be/);
    }
    await expect(db.query(
      `insert into public.terms_versions(org_id, key, sha256, body) select $1, 'Delivery Note', public.terms_body_sha256(b), b from (select $2::jsonb as b) x`, [ORG_A, ok],
    )).rejects.toThrow(/check constraint/);
  });

  it('accepts only {id, text} blocks with unique ids and LF line endings', async () => {
    for (const body of [
      '[{"id":"t","text":"x","html":"<b>not hashed</b>"}]',
      '[{"id":"t"}]',
      '[{"id":"t","text":1}]',
      '["just text"]',
      '[{"id":"T","text":"x"}]',
      '[{"id":"t","text":""}]',
      '[{"id":"t","text":"a\\r\\nb"}]',
      '[{"id":"t","text":"x"},{"id":"t","text":"y"}]',
    ]) {
      await expect(insertTerms(ORG_A, 'shape-test', body), body).rejects.toThrow(/body must be/);
    }
  });

  it('rejects a sha256 that does not match the body', async () => {
    for (const sha of [SHA('f'), SHA('F'), 'ABC', termsSha256([{ id: 't', text: 'other text' }])]) {
      await expect(db.query(
        `insert into public.terms_versions(org_id, key, sha256, body) values ($1,'delivery-note',$2,'[{"id":"t","text":"x"}]')`, [ORG_A, sha],
      )).rejects.toThrow(/sha256 does not match|check constraint/);
    }
  });

  it('hashes exactly as lib/terms/versions.ts, over every BMP code point and astral text', async () => {
    let bmp = '';
    for (let cp = 1; cp <= 0xffff; cp++) if (cp < 0xd800 || cp > 0xdfff) bmp += String.fromCodePoint(cp);
    const blocks = [
      { id: 'all-bmp', text: bmp.replace(/\r/g, '') },
      { id: 'astral', text: 'Signed 😀 👩‍👩‍👧 𝔘 \u{10FFFF} \u{1F1FF}\u{1F1E6}' },
      { id: 'tricky', text: 'a"b\\c/d\u2028\u2029\u007f\u0085\u200e\u202e\t\n\b\f\u0001\u001f e\u0301 é' },
    ];
    const sha = termsSha256(blocks);
    const r = await db.query(`select public.terms_body_sha256($1::jsonb) as sha`, [JSON.stringify(blocks)]);
    expect(r.rows[0].sha).toBe(sha);
    await asService(async () => {
      await db.query(`insert into public.terms_versions(org_id, key, sha256, body) values ($1,'parity',$2,$3::jsonb)`, [ORG_A, sha, JSON.stringify(blocks)]);
    });
  });

  it('the hash function is not callable by clients', async () => {
    await expect(as(db, 'authenticated', ADMIN_A, () => db.query(`select public.terms_body_sha256('[]'::jsonb)`)))
      .rejects.toThrow(/permission denied/);
  });
});

describe('entry_files signature metadata', () => {
  const insertSig = (extra: Record<string, unknown>, kind = 'signature') => {
    const cols = Object.keys(extra);
    return db.query(
      `insert into public.entry_files(entry_id, field_key, kind, storage_path, file_name${cols.map((c) => `, ${c}`).join('')})
       values ($1, 'Signature4', $2, 'delivery-note/x/sig.png', 'signature.png'${cols.map((_, i) => `, $${i + 3}`).join('')}) returning id, org_id`,
      [entryA, kind, ...Object.values(extra)],
    );
  };

  it('the server stores signed_at, signer_role, sign_method and the terms version of the same org', async () => {
    const r = await insertSig({ signed_at: ago(3), signer_role: 'customer', sign_method: 'draw', terms_version_id: termsA });
    expect(r.rows[0].org_id).toBe(ORG_A);
    const rep = await insertSig({ signed_at: ago(1), signer_role: 'sales_rep', sign_method: 'type' });
    const seen = await as(db, 'authenticated', STAFF_A, async () =>
      (await db.query(`select signer_role, sign_method, terms_version_id from public.entry_files where id = any($1::uuid[]) order by signer_role`, [[r.rows[0].id, rep.rows[0].id]])).rows);
    expect(seen).toEqual([
      { signer_role: 'customer', sign_method: 'draw', terms_version_id: termsA },
      { signer_role: 'sales_rep', sign_method: 'type', terms_version_id: null },
    ]);
  });

  it('rejects a terms version from another org', async () => {
    await expect(insertSig({ terms_version_id: termsE })).rejects.toThrow(/foreign key/);
  });

  it('checks method and role, and keeps the metadata on signature rows only', async () => {
    await expect(insertSig({ sign_method: 'scribble' })).rejects.toThrow(/check constraint/);
    await expect(insertSig({ signer_role: 'Inspector A. Demo' })).rejects.toThrow(/check constraint/);
    await expect(insertSig({ signed_at: ago(1) }, 'file')).rejects.toThrow(/check constraint/);
    await expect(insertSig({ terms_version_id: termsA }, 'document')).rejects.toThrow(/check constraint/);
    await insertSig({}, 'file');
  });

  it('a signature is never dated after the row that stores it (5 minutes of skew allowed)', async () => {
    await expect(insertSig({ signed_at: ago(-60) })).rejects.toThrow(/entry_files_signed_at_check/);
    await insertSig({ signed_at: ago(-2) });
  });

  it('existing rows and inserts without metadata still work (additive, nullable)', async () => {
    const r = await insertSig({});
    const row = (await db.query(`select signed_at, signer_role, sign_method, terms_version_id from public.entry_files where id = $1`, [r.rows[0].id])).rows[0];
    expect(row).toEqual({ signed_at: null, signer_role: null, sign_method: null, terms_version_id: null });
  });

  it('a re-signed signature row can be removed; its terms version stays', async () => {
    const r = await insertSig({ signer_role: 'customer', sign_method: 'draw', terms_version_id: termsA });
    await db.query(`delete from public.entry_files where id = $1`, [r.rows[0].id]);
    expect(await count(`select count(*) as n from public.terms_versions where id = $1`, [termsA])).toBe(1);
  });

  it('clients still cannot write entry_files or set the metadata', async () => {
    await expect(as(db, 'authenticated', ADMIN_A, () =>
      db.query(`insert into public.entry_files(entry_id, field_key, kind, storage_path, file_name, sign_method) values ($1,'Signature4','signature','p','f','draw')`, [entryA]),
    )).rejects.toThrow(/permission denied/);
    await expect(as(db, 'authenticated', ADMIN_A, () =>
      db.query(`update public.entry_files set terms_version_id = $1 where entry_id = $2`, [termsA, entryA]),
    )).rejects.toThrow(/permission denied/);
  });
});
