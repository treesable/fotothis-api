// Database tests run against a throwaway Postgres: TEST_DATABASE_URL=postgres://… npm test.
// Without it they're skipped (the pure tests still run).
import { randomUUID } from "node:crypto";
import { _closeForTests, migrate, query } from "../lib/db.js";

export const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? null;
export const skipWithoutDatabase = testDatabaseUrl ? false : "TEST_DATABASE_URL not set";

/** Empty database with the migrations applied. */
export async function freshDatabase() {
  process.env.DATABASE_URL = testDatabaseUrl;
  await _closeForTests();
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: testDatabaseUrl });
  await client.connect();
  await client.query("drop schema public cascade; create schema public;");
  await client.end();
  await migrate();
}

export async function addMember(overrides = {}) {
  const member = { id: randomUUID(), nickname: "Marcel", colour: "#FF7A5C", lastSeen: new Date(), ...overrides };
  await query("insert into members (id, nickname, colour, last_seen_at) values ($1, $2, $3, $4)",
    [member.id, member.nickname, member.colour, member.lastSeen]);
  return member;
}

export async function addChallenge(creator, { status = "waiting", createdAt = new Date(), startsAt = null, endsAt = null, code } = {}) {
  const id = randomUUID();
  await query(
    "insert into challenges (id, code, creator_id, status, created_at, starts_at, ends_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [id, code ?? `T${id.slice(0, 2).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`, creator.id, status, createdAt, startsAt, endsAt],
  );
  await query("insert into challenge_members (challenge_id, member_id) values ($1, $2)", [id, creator.id]);
  return id;
}

export { _closeForTests, query };
