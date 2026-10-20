// Postgres (Neon via the Vercel Marketplace in production, a local server in tests).
// Migrations in db/migrations run once per instance, before the first query, under an
// advisory lock so two cold starts never run them twice.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// `date` columns (a member's local calendar day) stay "YYYY-MM-DD" strings: as JS Dates they'd
// land on local midnight and shift a day when converted to UTC.
pg.types.setTypeParser(1082, (value) => value);

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), "../db/migrations");
const LOCK_ID = 46_120_001;

let pool = null;
let ready = null;

export function isConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw Object.assign(new Error("DATABASE_URL is not set"), { status: 503 });
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    pool = new pg.Pool({ connectionString: url, max: 3, ssl: local ? false : { rejectUnauthorized: true } });
  }
  return pool;
}

/** Runs pending migrations (once per instance). */
export async function migrate() {
  ready ??= (async () => {
    const client = await getPool().connect();
    try {
      await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
      await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
      const done = new Set((await client.query("select name from schema_migrations")).rows.map((row) => row.name));
      const files = (await readdir(MIGRATIONS)).filter((name) => name.endsWith(".sql")).sort();
      for (const name of files) {
        if (done.has(name)) continue;
        await client.query("begin");
        try {
          await client.query(await readFile(path.join(MIGRATIONS, name), "utf8"));
          await client.query("insert into schema_migrations (name) values ($1)", [name]);
          await client.query("commit");
          console.log(`migration applied: ${name}`);
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      }
    } finally {
      await client.query("select pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
      client.release();
    }
  })().catch((error) => {
    ready = null;  // try again on the next request
    throw error;
  });
  return ready;
}

export async function query(text, params = []) {
  await migrate();
  return getPool().query(text, params);
}

/** Runs `work(client)` in one transaction. */
export async function transaction(work) {
  await migrate();
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Tests only. */
export async function _closeForTests() {
  await pool?.end();
  pool = null;
  ready = null;
}
