import { Client } from 'pg';

export async function connect(): Promise<Client> {
  const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect();
  return c;
}

type Role = 'anon' | 'authenticated';

/** Runs fn inside a transaction as an API role with the given JWT subject, then rolls back. */
export async function as<T>(c: Client, role: Role, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await c.query('begin');
  try {
    await c.query(`set local role ${role}`);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(userId ? { sub: userId, role } : { role }),
    ]);
    return await fn();
  } finally {
    await c.query('rollback');
  }
}
