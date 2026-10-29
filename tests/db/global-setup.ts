import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

// Builds a throwaway database: Supabase shim, then every migration in order.
// DATABASE_URL must point at a Postgres 15+ server with a superuser; it is never a real project.
const root = path.resolve(__dirname, '../..');
const TEST_DB = 'tt_test';

export default async function setup() {
  const adminUrl = process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres';
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${TEST_DB}`;
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query(readFileSync(path.join(root, 'tests/db/shim.sql'), 'utf8'));
  const dir = path.join(root, 'supabase/migrations');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    await db.query(readFileSync(path.join(dir, f), 'utf8'));
  }
  await db.end();

  process.env.TEST_DATABASE_URL = url.toString();
}
