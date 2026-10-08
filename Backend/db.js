import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const { Pool, types } = pg;

// DATE columns (oid 1082) stay plain 'YYYY-MM-DD' strings. By default pg turns them into JS Dates,
// which serialise to long ISO timestamps and break the frontend's due-date handling.
types.setTypeParser(1082, (v) => v);

const url = process.env.DATABASE_URL || '';
const local = /localhost|127\.0\.0\.1/.test(url);
const ssl = process.env.DATABASE_SSL === 'false' || local ? false : { rejectUnauthorized: false };

export const pool = new Pool({ connectionString: url, ssl, max: 10 });
pool.on('error', (e) => console.error('Postgres pool error:', e.message));   // an idle-client error must not crash the server

/** Runs fn(client) inside BEGIN/COMMIT, rolling back on error. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally { client.release(); }
}

/** Applies schema.sql (every statement is "if not exists", so this is safe to run on every start). */
export async function initSchema() {
  await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
}

/**
 * Creates the Daily / Weekly / Monthly lists for a user if they have none.
 * Idempotent and safe to call concurrently. auth.js calls it for new users and GET /lists calls it
 * too, so a user can never end up without their default lists. Resolves true when lists were created.
 */
export function seedDefaultLists(userId) {
  return tx(async (c) => {
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [String(userId)]);
    const has = await c.query('select 1 from lists where user_id = $1 and is_default limit 1', [userId]);
    if (has.rowCount) return false;
    await c.query(
      `insert into lists (user_id, name, is_default, recurrence, created_at)
       select $1::uuid, v.name, true, v.rec, now() + v.n * interval '1 millisecond'
       from (values ('Daily','daily',1), ('Weekly','weekly',2), ('Monthly','monthly',3)) as v(name, rec, n)`,
      [userId]);
    return true;
  });
}
