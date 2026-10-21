import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { secretFor } from "../lib/challenges/auth.js";
import { _resetSent, sent } from "../lib/challenges/notify.js";
import {
  board, cheer, createChallenge, createMember, debugEnd, deleteMember, join, me, previewByCode, recordProgress, removeMember, updateMember,
} from "../lib/challenges/service.js";
import { _closeForTests, freshDatabase, query, skipWithoutDatabase } from "./db-helpers.js";

const skip = skipWithoutDatabase;
beforeEach(async () => {
  process.env.MEMBER_KEY = "k".repeat(64);
  _resetSent();
  if (!skip) await freshDatabase();
});
after(async () => { if (!skip) await _closeForTests(); });

const t0 = new Date("2026-10-20T10:00:00Z");  // a Tuesday, 12:00 in Copenhagen
const hours = (n) => new Date(t0.getTime() + n * 3600 * 1000);
const member = (nickname, extra = {}) => createMember({ nickname, colour: "#8FD19E", timeZone: "Europe/Copenhagen", ...extra }, t0);
const errorCode = (code) => (error) => error.code === code;

const outsideDay = (localDate, extra = {}) => ({
  localDate, outside: true, photos: 1, newSpecies: [], lockedMinutes: 0, emergencyUnlocks: 0, steps: null,
  timeZone: "Europe/Copenhagen", ...extra,
});

async function crewOf(count) {
  const creator = await member("Marcel");
  const challenge = await createChallenge(creator.memberId, t0);
  const others = [];
  for (let i = 1; i < count; i++) {
    const friend = await member(`Friend ${i}`);
    await join(friend.memberId, challenge.code, {}, hours(i * 0.01));
    others.push(friend);
  }
  return { creator, challenge, others };
}

test("a member gets an id and the secret derived from it", { skip }, async () => {
  const created = await member("Marcel");
  assert.equal(created.secret, secretFor(created.memberId));
  const { rows } = await query("select * from members");
  assert.equal(rows.length, 1);
  assert.equal(Object.keys(rows[0]).some((column) => /secret/.test(column)), false, "No secret stored");
  await assert.rejects(member("This nickname is far too long"), errorCode("bad_nickname"));
  await assert.rejects(member("Marcel", { colour: "coral" }), errorCode("bad_colour"));
});

test("creating twice returns the same waiting challenge", { skip }, async () => {
  const { memberId } = await member("Marcel");
  const first = await createChallenge(memberId, t0);
  assert.match(first.code, /^[A-Z]{3,6}-\d{3}$/);
  assert.deepEqual(await createChallenge(memberId, t0), first);
  assert.deepEqual((await me(memberId)).challenge, { id: first.id, code: first.code, status: "waiting" });
});

test("the clock starts when the second person joins, and the creator hears about it", { skip }, async () => {
  const creator = await member("Marcel");
  const challenge = await createChallenge(creator.memberId, t0);
  const sofie = await member("Sofie");
  const joinedAt = hours(2);
  await join(sofie.memberId, challenge.code.toLowerCase().replace("-", " "), {}, joinedAt);
  const { rows } = await query("select status, starts_at, ends_at from challenges");
  assert.equal(rows[0].status, "active");
  assert.equal(rows[0].starts_at.getTime(), joinedAt.getTime());
  assert.equal(rows[0].ends_at.getTime() - joinedAt.getTime(), 7 * 24 * 3600 * 1000);
  assert.deepEqual(sent.map((m) => [m.kind, m.to]), [["joined", [creator.memberId]]]);
  // Joining again changes nothing.
  await join(sofie.memberId, challenge.code, {}, hours(3));
  assert.equal(sent.length, 1);
});

test("a crew is at most 8", { skip }, async () => {
  const { challenge } = await crewOf(8);
  const ninth = await member("Ninth");
  await assert.rejects(join(ninth.memberId, challenge.code, {}, hours(1)), errorCode("crew_full"));
  assert.equal((await previewByCode(challenge.code)).spotsLeft, 0);
});

test("one challenge per person; an unjoined one of your own gets out of the way", { skip }, async () => {
  const { challenge, others } = await crewOf(2);
  const outsider = await member("Ola");
  const own = await createChallenge(outsider.memberId, t0);
  // Ola's own challenge has nobody else in it: joining Marcel's drops it.
  await join(outsider.memberId, challenge.code, {}, hours(1));
  assert.equal((await query("select count(*)::int as n from challenges where id = $1", [own.id])).rows[0].n, 0);
  // Sofie is in a running challenge: she can't start or join another.
  const other = await crewOf(2);
  await assert.rejects(join(others[0].memberId, other.challenge.code, {}, hours(1)), errorCode("already_in_challenge"));
  await assert.rejects(createChallenge(others[0].memberId, hours(1)), errorCode("already_in_challenge"));
});

test("unknown and ended codes", { skip }, async () => {
  const someone = await member("Ola");
  await assert.rejects(join(someone.memberId, "OAK-000", {}, t0), errorCode("challenge_not_found"));
  await assert.rejects(join(someone.memberId, "nonsense", {}, t0), errorCode("challenge_not_found"));
  const { challenge } = await crewOf(2);
  await assert.rejects(join(someone.memberId, challenge.code, {}, hours(24 * 8)), errorCode("challenge_ended"));
});

test("the board is for members only", { skip }, async () => {
  const { creator, challenge } = await crewOf(2);
  const outsider = await member("Ola");
  await assert.rejects(board(outsider.memberId, challenge.id, hours(1)), errorCode("not_a_member"));
  await assert.rejects(recordProgress(outsider.memberId, challenge.id, outsideDay("2026-10-20"), hours(1)), errorCode("not_a_member"));
  await assert.rejects(board(creator.memberId, "not-a-uuid", hours(1)), errorCode("challenge_not_found"));
  assert.equal((await board(creator.memberId, challenge.id, hours(1))).members.length, 2);
});

test("progress builds the board: points, ranking, dots, goal, feed", { skip }, async () => {
  const { creator, challenge, others: [sofie] } = await crewOf(2);
  // Marcel: outside today with a new plant and 3 locked hours. Sofie: steps only.
  await recordProgress(creator.memberId, challenge.id,
    outsideDay("2026-10-20", { photos: 2, newSpecies: ["Common Oak"], lockedMinutes: 200 }), hours(4));
  await recordProgress(sofie.memberId, challenge.id,
    outsideDay("2026-10-20", { outside: false, photos: 0, steps: 5200 }), hours(4));

  const view = await board(sofie.memberId, challenge.id, hours(5));
  assert.equal(view.challenge.status, "active");
  assert.equal(view.challenge.day, 1);
  const [first, second] = view.members;
  assert.equal(first.nickname, "Marcel");
  assert.equal(first.points, 10 + 5 + 2 * 2 + 3);
  assert.deepEqual([first.daysOutside, first.newSpecies, first.lockedHours], [1, 1, 3]);
  assert.equal(first.days[0], "outside");
  assert.equal(first.days.length, 7);
  assert.equal(first.days[1], "future");
  assert.equal(second.isMe, true);
  assert.equal(second.days[0], "steps", "5,000+ steps without a photo: a walk day");
  assert.deepEqual([second.walkDays, second.points], [1, 5]);
  // Active days together: Marcel's photo day + Sofie's walk day.
  assert.deepEqual(view.goal, { daysOutside: 2, target: 10 });
  assert.deepEqual(view.feed.map((item) => item.kind), ["new_species", "outside", "started", "joined"]);
  assert.deepEqual(view.feed[0].data, { name: "Common Oak" });
  assert.deepEqual(sent.map((m) => m.kind), ["joined", "outside"]);
});

test("progress is idempotent per day, and only the first photo of a day pings the crew", { skip }, async () => {
  const { creator, challenge } = await crewOf(2);
  await recordProgress(creator.memberId, challenge.id, outsideDay("2026-10-20"), hours(1));
  await recordProgress(creator.memberId, challenge.id, outsideDay("2026-10-20", { photos: 3 }), hours(2));
  const { rows } = await query("select photos from daily_progress");
  assert.deepEqual(rows.map((row) => row.photos), [3]);
  assert.equal(sent.filter((m) => m.kind === "outside").length, 1);
});

test("progress outside the challenge's days, before the start or in the future doesn't count", { skip }, async () => {
  const creator = await member("Marcel");
  const challenge = await createChallenge(creator.memberId, t0);
  assert.deepEqual(await recordProgress(creator.memberId, challenge.id, outsideDay("2026-10-20"), t0),
    { accepted: false, reason: "not_started" });
  const sofie = await member("Sofie");
  await join(sofie.memberId, challenge.code, {}, hours(1));
  assert.deepEqual(await recordProgress(creator.memberId, challenge.id, outsideDay("2026-10-19"), hours(2)),
    { accepted: false, reason: "outside_challenge_days" });
  await assert.rejects(recordProgress(creator.memberId, challenge.id, outsideDay("2026-10-21"), hours(2)), errorCode("bad_progress"));
  await assert.rejects(recordProgress(creator.memberId, challenge.id, outsideDay("2026-10-20", { photos: 9 }), hours(2)),
    errorCode("bad_progress"));
});

test("steps stay private without the switch, and switching off hides past steps", { skip }, async () => {
  const { creator, challenge, others: [sofie] } = await crewOf(2);
  await recordProgress(sofie.memberId, challenge.id, outsideDay("2026-10-20", { outside: false, photos: 0, steps: 9000 }), hours(1));
  assert.equal((await board(creator.memberId, challenge.id, hours(2))).members.find((m) => !m.isMe).days[0], "steps");
  await updateMember(sofie.memberId, { shareSteps: false }, hours(2));
  assert.equal((await query("select steps from daily_progress")).rows[0].steps, null);
  await recordProgress(sofie.memberId, challenge.id, outsideDay("2026-10-20", { outside: false, photos: 0, steps: 9500 }), hours(3));
  assert.equal((await query("select steps from daily_progress")).rows[0].steps, null, "Not stored at all");
});

test("cheers and nudges: crew only, not yourself, one nudge a day", { skip }, async () => {
  const { creator, challenge, others: [sofie] } = await crewOf(2);
  await cheer(creator.memberId, challenge.id, { to: sofie.memberId, kind: "cheer" }, hours(1));
  await cheer(creator.memberId, challenge.id, { to: sofie.memberId, kind: "nudge" }, hours(1));
  await assert.rejects(cheer(creator.memberId, challenge.id, { to: sofie.memberId, kind: "nudge" }, hours(2)), errorCode("already_nudged"));
  await cheer(creator.memberId, challenge.id, { to: sofie.memberId, kind: "nudge" }, hours(24), "Next day is fine");
  await assert.rejects(cheer(creator.memberId, challenge.id, { to: creator.memberId, kind: "cheer" }, hours(1)), errorCode("not_yourself"));
  const outsider = await member("Ola");
  await assert.rejects(cheer(creator.memberId, challenge.id, { to: outsider.memberId, kind: "cheer" }, hours(1)), errorCode("member_not_found"));
  await assert.rejects(cheer(creator.memberId, challenge.id, { to: sofie.memberId, kind: "hug" }, hours(1)), errorCode("bad_kind"));
  for (let i = 0; i < 4; i++) await cheer(creator.memberId, challenge.id, { to: sofie.memberId, kind: "cheer" }, hours(1));
  await assert.rejects(cheer(creator.memberId, challenge.id, { to: sofie.memberId, kind: "cheer" }, hours(1)), errorCode("too_many_cheers"));
  assert.deepEqual(sent.filter((m) => m.kind !== "joined").map((m) => [m.kind, m.to[0]]).slice(0, 2),
    [["cheer", sofie.memberId], ["nudge", sofie.memberId]]);
});

test("leaving deletes your progress; the last one out deletes the challenge", { skip }, async () => {
  const { creator, challenge, others: [sofie] } = await crewOf(2);
  await recordProgress(sofie.memberId, challenge.id, outsideDay("2026-10-20"), hours(1));
  await removeMember(sofie.memberId, challenge.id, sofie.memberId, hours(2));
  assert.equal((await query("select count(*)::int as n from daily_progress")).rows[0].n, 0);
  assert.equal((await board(creator.memberId, challenge.id, hours(2))).members.length, 1);
  // Sofie can start fresh elsewhere.
  await createChallenge(sofie.memberId, hours(3));
  await removeMember(creator.memberId, challenge.id, creator.memberId, hours(3));
  assert.equal((await query("select count(*)::int as n from challenges where id = $1", [challenge.id])).rows[0].n, 0);
});

test("only the creator removes people, and removed people can't rejoin", { skip }, async () => {
  const { creator, challenge, others: [sofie, ola] } = await crewOf(3);
  await recordProgress(ola.memberId, challenge.id, outsideDay("2026-10-20"), hours(1));
  await assert.rejects(removeMember(sofie.memberId, challenge.id, ola.memberId, hours(1)), errorCode("creator_only"));
  await removeMember(creator.memberId, challenge.id, ola.memberId, hours(1));
  assert.equal((await query("select count(*)::int as n from daily_progress where member_id = $1", [ola.memberId])).rows[0].n, 0);
  await assert.rejects(join(ola.memberId, challenge.code, {}, hours(2)), errorCode("removed"));
  await assert.rejects(board(ola.memberId, challenge.id, hours(2)), errorCode("not_a_member"));
});

test("when the creator leaves, the longest-standing member takes over", { skip }, async () => {
  const { creator, challenge, others: [sofie] } = await crewOf(3);
  await removeMember(creator.memberId, challenge.id, creator.memberId, hours(1));
  assert.equal((await query("select creator_id from challenges")).rows[0].creator_id, sofie.memberId);
});

test("deleting my data removes me everywhere; the crew keeps going without me", { skip }, async () => {
  const { creator, challenge, others: [sofie, ola] } = await crewOf(3);
  await recordProgress(creator.memberId, challenge.id, outsideDay("2026-10-20"), hours(1));
  await cheer(creator.memberId, challenge.id, { to: sofie.memberId, kind: "cheer" }, hours(1));
  await deleteMember(creator.memberId, hours(2));
  const count = async (sql) => (await query(sql, [creator.memberId])).rows[0].n;
  assert.equal(await count("select count(*)::int as n from members where id = $1"), 0);
  assert.equal(await count("select count(*)::int as n from challenge_members where member_id = $1"), 0);
  assert.equal(await count("select count(*)::int as n from daily_progress where member_id = $1"), 0);
  assert.equal(await count("select count(*)::int as n from events where member_id = $1"), 0);
  assert.equal(await count("select count(*)::int as n from cheers where from_member = $1 or to_member = $1"), 0);
  assert.equal((await query("select creator_id from challenges")).rows[0].creator_id, sofie.memberId);
  const view = await board(ola.memberId, challenge.id, hours(2));
  assert.deepEqual(view.members.map((m) => m.nickname).sort(), ["Friend 1", "Friend 2"]);
  // Twice is fine (the phone retries after a lost answer).
  assert.deepEqual(await deleteMember(creator.memberId, hours(3)), { deleted: true });
});

test("deleting my data takes a challenge nobody else is in with it", { skip }, async () => {
  const creator = await member("Marcel");
  await createChallenge(creator.memberId, t0);
  await deleteMember(creator.memberId, hours(1));
  assert.equal((await query("select count(*)::int as n from challenges")).rows[0].n, 0);
});

test("after 7 days the challenge ends once, for everyone", { skip }, async () => {
  const { creator, challenge, others: [sofie] } = await crewOf(2);
  _resetSent();
  const later = hours(24 * 7 + 1);
  const view = await board(creator.memberId, challenge.id, later);
  assert.equal(view.challenge.status, "ended");
  assert.equal(view.challenge.day, 7);
  await board(sofie.memberId, challenge.id, later);
  assert.deepEqual(sent.map((m) => m.kind), ["complete"]);
  await assert.rejects(recordProgress(creator.memberId, challenge.id, outsideDay("2026-10-27"), later), errorCode("challenge_ended"));
  assert.equal((await me(creator.memberId)).challenge, null, "Free to start another round");
});

test("the debug end only works with CHALLENGE_DEBUG=1", { skip }, async () => {
  const { creator, challenge } = await crewOf(2);
  delete process.env.CHALLENGE_DEBUG;
  await assert.rejects(debugEnd(creator.memberId, challenge.id, hours(1)), errorCode("not_found"));
  process.env.CHALLENGE_DEBUG = "1";
  try {
    _resetSent();
    await debugEnd(creator.memberId, challenge.id, hours(1));
    assert.equal((await board(creator.memberId, challenge.id, hours(1))).challenge.status, "ended");
    assert.deepEqual(sent.map((m) => m.kind), ["complete"]);
  } finally {
    delete process.env.CHALLENGE_DEBUG;
  }
});
