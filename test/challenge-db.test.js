import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { runRetention } from "../lib/challenges/retention.js";
import { migrate } from "../lib/db.js";
import { _closeForTests, addChallenge, addMember, freshDatabase, query, skipWithoutDatabase } from "./db-helpers.js";

const skip = skipWithoutDatabase;
beforeEach(async () => { if (!skip) await freshDatabase(); });
after(async () => { if (!skip) await _closeForTests(); });

const days = (n) => n * 24 * 3600 * 1000;
const now = new Date("2026-12-01T12:00:00Z");

async function addProgress(challengeId, memberId, localDate = "2026-11-20") {
  await query(
    `insert into daily_progress (challenge_id, member_id, local_date, outside, photos, locked_minutes, emergency_unlocks)
     values ($1, $2, $3, true, 1, 60, 0)`,
    [challengeId, memberId, localDate],
  );
}

test("migrations apply once", { skip }, async () => {
  await migrate();
  const { rows } = await query("select name from schema_migrations");
  assert.deepEqual(rows.map((row) => row.name), ["001_challenges.sql", "002_lock_marks.sql"]);
});

test("two cold starts migrating at once both succeed, each migration applied once", { skip }, async () => {
  await query("drop schema public cascade; create schema public;");
  // A second copy of the module = a second serverless instance with its own pool.
  const other = await import("../lib/db.js?instance=2");
  await _closeForTests();
  try {
    await Promise.all([migrate(), other.migrate()]);
    const { rows } = await query("select name from schema_migrations");
    assert.deepEqual(rows.map((row) => row.name), ["001_challenges.sql", "002_lock_marks.sql"]);
  } finally {
    await other._closeForTests();
  }
});

test("the database refuses impossible values too", { skip }, async () => {
  await assert.rejects(addMember({ nickname: "x".repeat(17) }), /check/, "Nickname max 16");
  await assert.rejects(addMember({ nickname: "" }), /check/);
  await assert.rejects(addMember({ colour: "red" }), /check/);
  const member = await addMember();
  const challengeId = await addChallenge(member);
  await assert.rejects(query(
    `insert into daily_progress (challenge_id, member_id, local_date, outside, photos, locked_minutes, emergency_unlocks)
     values ($1, $2, '2026-11-20', true, 7, 0, 0)`, [challengeId, member.id]), /check/, "Max 6 photos");
  await assert.rejects(query(
    "insert into challenges (id, code, creator_id, status) values (gen_random_uuid(), 'ABC-123', $1, 'active')", [member.id]),
    /check/, "An active challenge has a start");
});

test("progress needs a membership; leaving deletes it", { skip }, async () => {
  const a = await addMember();
  const b = await addMember({ nickname: "Sofie" });
  const challengeId = await addChallenge(a);
  await assert.rejects(addProgress(challengeId, b.id), /foreign key/, "Not a member");
  await query("insert into challenge_members (challenge_id, member_id) values ($1, $2)", [challengeId, b.id]);
  await addProgress(challengeId, b.id);
  await query("delete from challenge_members where challenge_id = $1 and member_id = $2", [challengeId, b.id]);
  const { rows } = await query("select count(*)::int as n from daily_progress where member_id = $1", [b.id]);
  assert.equal(rows[0].n, 0);
});

test("one nudge per sender, receiver and day", { skip }, async () => {
  const a = await addMember();
  const b = await addMember({ nickname: "Sofie" });
  const challengeId = await addChallenge(a);
  const nudge = () => query(
    "insert into cheers (challenge_id, from_member, to_member, kind, local_date) values ($1, $2, $3, 'nudge', '2026-11-20')",
    [challengeId, a.id, b.id]);
  await nudge();
  await assert.rejects(nudge(), /unique/);
  // Cheers aren't limited this way.
  for (let i = 0; i < 2; i++) {
    await query("insert into cheers (challenge_id, from_member, to_member, kind, local_date) values ($1, $2, $3, 'cheer', '2026-11-20')",
      [challengeId, a.id, b.id]);
  }
});

test("retention: ended challenges go after 30 days, with everything in them", { skip }, async () => {
  const a = await addMember({ lastSeen: now });
  const old = await addChallenge(a, { status: "ended", startsAt: new Date(now - days(40)), endsAt: new Date(now - days(31)) });
  const recent = await addChallenge(a, { status: "ended", startsAt: new Date(now - days(36)), endsAt: new Date(now - days(29)) });
  await addProgress(old, a.id);
  await addProgress(recent, a.id);
  await query("insert into events (challenge_id, member_id, kind) values ($1, $2, 'joined')", [old, a.id]);

  const result = await runRetention(now);
  assert.equal(result.challengesDeleted, 1);
  const kept = (await query("select id from challenges")).rows.map((row) => row.id);
  assert.deepEqual(kept, [recent]);
  assert.equal((await query("select count(*)::int as n from daily_progress where challenge_id = $1", [old])).rows[0].n, 0);
  assert.equal((await query("select count(*)::int as n from events")).rows[0].n, 0);
});

test("retention: an overdue active challenge ends, and is kept for its 30 days", { skip }, async () => {
  const a = await addMember({ lastSeen: now });
  const id = await addChallenge(a, { status: "active", startsAt: new Date(now - days(8)), endsAt: new Date(now - days(1)) });
  await runRetention(now);
  assert.equal((await query("select status from challenges where id = $1", [id])).rows[0].status, "ended");
});

test("retention: a challenge nobody joined is dropped after 30 days", { skip }, async () => {
  const a = await addMember({ lastSeen: now });
  await addChallenge(a, { createdAt: new Date(now - days(31)) });
  const fresh = await addChallenge(a, { createdAt: new Date(now - days(2)) });
  await runRetention(now);
  assert.deepEqual((await query("select id from challenges")).rows.map((row) => row.id), [fresh]);
});

test("retention: members idle 90 days without a challenge are deleted", { skip }, async () => {
  const idle = await addMember({ lastSeen: new Date(now - days(91)) });
  const recent = await addMember({ lastSeen: new Date(now - days(89)) });
  const idleButInChallenge = await addMember({ lastSeen: new Date(now - days(120)) });
  await addChallenge(idleButInChallenge, { status: "ended", startsAt: new Date(now - days(20)), endsAt: new Date(now - days(13)) });

  const result = await runRetention(now);
  assert.equal(result.membersDeleted, 1);
  const left = (await query("select id from members")).rows.map((row) => row.id).sort();
  assert.deepEqual(left, [recent.id, idleButInChallenge.id].sort());
  assert.equal(left.includes(idle.id), false);
});
