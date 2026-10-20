// Outside Challenges: the rules (docs/CHALLENGES.md). HTTP lives in api/v1/; this module only
// knows members, challenges and totals, so it's tested straight against Postgres.
import { randomUUID } from "node:crypto";
import { query, transaction } from "../db.js";
import { secretFor } from "./auth.js";
import { generateCode, normalizeCode } from "./codes.js";
import { notify } from "./notify.js";
import { rank, validateProgress } from "./score.js";

export const LIMITS = {
  crewSize: 8,
  lengthDays: 7,
  goalDaysPerMember: 5,
  feedItems: 5,
  stepsOnlyDay: 3000,
  cheersPerPairPerDay: 5,
  /** Local hour from which the day-6 nudge can go out. */
  daySixHour: 18,
};

export class ApiError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// MARK: - Small helpers

export function localDateIn(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function addDays(localDate, n) {
  const date = new Date(`${localDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** The 7 local dates a member's dots and points cover, from the start in their time zone. */
export function challengeDates(startsAt, timeZone, lengthDays = LIMITS.lengthDays) {
  const first = localDateIn(startsAt, timeZone);
  return Array.from({ length: lengthDays }, (_, i) => addDays(first, i));
}

export function cleanTimeZone(value) {
  if (typeof value !== "string" || value.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

export function cleanNickname(value) {
  if (typeof value !== "string") return null;
  // No control characters; one space between words.
  const clean = value.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
  const length = [...clean].length;
  return length >= 1 && length <= 16 ? clean : null;
}

const COLOUR = /^#[0-9A-Fa-f]{6}$/;
const APNS_TOKEN = /^[0-9a-f]{64,200}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value, what) {
  if (typeof value !== "string" || !UUID.test(value)) throw new ApiError(404, `${what}_not_found`);
  return value.toLowerCase();
}

// MARK: - Members

export async function createMember(input, now = new Date()) {
  const nickname = cleanNickname(input?.nickname);
  if (!nickname) throw new ApiError(400, "bad_nickname", "Nickname must be 1–16 characters");
  if (!COLOUR.test(input?.colour ?? "")) throw new ApiError(400, "bad_colour");
  const id = randomUUID();
  await query(
    `insert into members (id, nickname, colour, apns_token, apns_sandbox, share_steps, time_zone, created_at, last_seen_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [id, nickname, input.colour.toUpperCase(),
     APNS_TOKEN.test(input.apnsToken ?? "") ? input.apnsToken.toLowerCase() : null,
     input.apnsSandbox === true, input.shareSteps !== false, cleanTimeZone(input.timeZone) ?? "UTC", now],
  );
  return { memberId: id, secret: secretFor(id) };
}

export async function updateMember(memberId, input, now = new Date()) {
  const sets = [];
  const values = [];
  const set = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  if (input.nickname !== undefined) {
    const nickname = cleanNickname(input.nickname);
    if (!nickname) throw new ApiError(400, "bad_nickname", "Nickname must be 1–16 characters");
    set("nickname", nickname);
  }
  if (input.colour !== undefined) {
    if (!COLOUR.test(input.colour)) throw new ApiError(400, "bad_colour");
    set("colour", input.colour.toUpperCase());
  }
  if (input.apnsToken !== undefined) set("apns_token", APNS_TOKEN.test(input.apnsToken ?? "") ? input.apnsToken.toLowerCase() : null);
  if (input.apnsSandbox !== undefined) set("apns_sandbox", input.apnsSandbox === true);
  if (input.shareSteps !== undefined) set("share_steps", input.shareSteps === true);
  if (input.timeZone !== undefined) {
    const zone = cleanTimeZone(input.timeZone);
    if (zone) set("time_zone", zone);
  }
  set("last_seen_at", now);
  values.push(memberId);
  const { rowCount } = await query(`update members set ${sets.join(", ")} where id = $${values.length}`, values);
  if (!rowCount) throw new ApiError(401, "unknown_member");
  if (input.shareSteps === false) {
    // Stop sharing means the crew stops seeing steps already sent, too.
    await query("update daily_progress set steps = null where member_id = $1", [memberId]);
  }
}

async function memberRow(memberId, client = { query }) {
  const { rows } = await client.query("select * from members where id = $1", [memberId]);
  if (!rows[0]) throw new ApiError(401, "unknown_member");
  return rows[0];
}

/** The member's own profile and their current (not ended) challenge, if any. */
export async function me(memberId, now = new Date()) {
  const member = await memberRow(memberId);
  await query("update members set last_seen_at = $2 where id = $1", [memberId, now]);
  const current = await currentChallenge(memberId);
  return {
    memberId,
    nickname: member.nickname,
    colour: member.colour,
    shareSteps: member.share_steps,
    challenge: current ? { id: current.id, code: current.code, status: current.status } : null,
  };
}

async function currentChallenge(memberId, client = { query }) {
  const { rows } = await client.query(
    `select c.* from challenges c join challenge_members cm on cm.challenge_id = c.id
      where cm.member_id = $1 and not cm.removed and c.status <> 'ended'
      order by c.created_at desc limit 1`,
    [memberId],
  );
  return rows[0] ?? null;
}

async function crewCount(challengeId, client) {
  const { rows } = await client.query(
    "select count(*)::int as n from challenge_members where challenge_id = $1 and not removed", [challengeId]);
  return rows[0].n;
}

/**
 * Max one challenge per person (v1). A challenge you created that nobody joined yet doesn't
 * block you: it's dropped when you start or join another.
 */
async function clearWayForNewChallenge(memberId, client, exceptId = null) {
  const current = await currentChallenge(memberId, client);
  if (!current || current.id === exceptId) return;
  const soloWaiting = current.status === "waiting" && current.creator_id === memberId
    && await crewCount(current.id, client) === 1;
  if (!soloWaiting) throw new ApiError(409, "already_in_challenge", "You're already in a challenge");
  await client.query("delete from challenges where id = $1", [current.id]);
}

// MARK: - Challenges

/** Creates a waiting challenge (or returns the one you already have waiting). */
export async function createChallenge(memberId, now = new Date()) {
  return transaction(async (client) => {
    await memberRow(memberId, client);
    const current = await currentChallenge(memberId, client);
    if (current?.status === "waiting" && current.creator_id === memberId) return { id: current.id, code: current.code, status: "waiting" };
    if (current) throw new ApiError(409, "already_in_challenge", "You're already in a challenge");

    const id = randomUUID();
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = generateCode();
      const { rowCount } = await client.query(
        `insert into challenges (id, code, creator_id, length_days, created_at) values ($1, $2, $3, $4, $5)
         on conflict (code) do nothing`,
        [id, code, memberId, LIMITS.lengthDays, now],
      );
      if (!rowCount) continue;
      await client.query("insert into challenge_members (challenge_id, member_id, joined_at) values ($1, $2, $3)", [id, memberId, now]);
      return { id, code, status: "waiting" };
    }
    throw new ApiError(503, "no_code", "Try again");
  });
}

/** What an invite shows before joining: inviter, who's in, status. No stats. */
export async function previewByCode(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) throw new ApiError(404, "challenge_not_found");
  const { rows } = await query("select * from challenges where code = $1", [code]);
  const challenge = rows[0];
  if (!challenge) throw new ApiError(404, "challenge_not_found");
  const crew = await query(
    `select m.id, m.nickname, m.colour from challenge_members cm join members m on m.id = cm.member_id
      where cm.challenge_id = $1 and not cm.removed order by cm.joined_at`,
    [challenge.id],
  );
  const inviter = crew.rows.find((row) => row.id === challenge.creator_id) ?? crew.rows[0] ?? null;
  return {
    code,
    status: challenge.status,
    lengthDays: challenge.length_days,
    inviter: inviter ? { nickname: inviter.nickname, colour: inviter.colour } : null,
    members: crew.rows.map((row) => ({ nickname: row.nickname, colour: row.colour })),
    spotsLeft: Math.max(0, LIMITS.crewSize - crew.rows.length),
  };
}

export async function join(memberId, rawCode, input = {}, now = new Date()) {
  const code = normalizeCode(rawCode);
  if (!code) throw new ApiError(404, "challenge_not_found");
  const result = await transaction(async (client) => {
    const member = await memberRow(memberId, client);
    const { rows } = await client.query("select * from challenges where code = $1 for update", [code]);
    const challenge = rows[0];
    if (!challenge) throw new ApiError(404, "challenge_not_found");
    if (challenge.status === "ended" || (challenge.ends_at && challenge.ends_at <= now)) {
      throw new ApiError(410, "challenge_ended", "This challenge has ended");
    }
    const existing = await client.query(
      "select removed from challenge_members where challenge_id = $1 and member_id = $2", [challenge.id, memberId]);
    if (existing.rows[0]?.removed) throw new ApiError(403, "removed", "You were removed from this challenge");
    if (existing.rows[0]) return { challenge, joinedNow: false, member };

    if (await crewCount(challenge.id, client) >= LIMITS.crewSize) throw new ApiError(409, "crew_full", "This crew is full");
    await clearWayForNewChallenge(memberId, client, challenge.id);

    await client.query("insert into challenge_members (challenge_id, member_id, joined_at) values ($1, $2, $3)",
      [challenge.id, memberId, now]);
    if (typeof input.shareSteps === "boolean") {
      await client.query("update members set share_steps = $2 where id = $1", [memberId, input.shareSteps]);
    }
    await client.query("insert into events (challenge_id, member_id, kind, created_at) values ($1, $2, 'joined', $3)",
      [challenge.id, memberId, now]);

    // The clock starts when the second person joins: 7 × 24 h from now.
    let started = false;
    if (challenge.status === "waiting" && await crewCount(challenge.id, client) >= 2) {
      const endsAt = new Date(now.getTime() + challenge.length_days * 24 * 3600 * 1000);
      await client.query("update challenges set status = 'active', starts_at = $2, ends_at = $3 where id = $1",
        [challenge.id, now, endsAt]);
      await client.query("insert into events (challenge_id, kind, created_at) values ($1, 'started', $2)", [challenge.id, now]);
      started = true;
    }
    return { challenge, joinedNow: true, started, member };
  });

  if (result.joinedNow) {
    const others = await otherMembers(result.challenge.id, memberId);
    await notify({ kind: "joined", challengeId: result.challenge.id, from: memberId, to: others,
      data: { nickname: result.member.nickname } }, now);
  }
  return { id: result.challenge.id, code: result.challenge.code };
}

async function otherMembers(challengeId, memberId) {
  const { rows } = await query(
    "select member_id from challenge_members where challenge_id = $1 and member_id <> $2 and not removed",
    [challengeId, memberId]);
  return rows.map((row) => row.member_id);
}

/** Loads a challenge the member belongs to (403 otherwise), ending it if its time is up. */
async function challengeForMember(memberId, rawChallengeId, now) {
  const challengeId = requireUuid(rawChallengeId, "challenge");
  const { rows } = await query(
    `select c.*, cm.removed from challenges c
       left join challenge_members cm on cm.challenge_id = c.id and cm.member_id = $2
      where c.id = $1`,
    [challengeId, memberId]);
  const challenge = rows[0];
  if (!challenge) throw new ApiError(404, "challenge_not_found");
  if (challenge.removed !== false) throw new ApiError(403, "not_a_member");
  if (challenge.status === "active" && challenge.ends_at <= now) {
    const ended = await query("update challenges set status = 'ended' where id = $1 and status = 'active'", [challengeId]);
    challenge.status = "ended";
    if (ended.rowCount) {
      await query("insert into events (challenge_id, kind, created_at) values ($1, 'ended', $2)", [challengeId, now]);
      const { rows: crew } = await query("select member_id from challenge_members where challenge_id = $1 and not removed", [challengeId]);
      await notify({ kind: "complete", challengeId, to: crew.map((row) => row.member_id) }, now);
    }
  }
  return challenge;
}

// MARK: - Progress

/**
 * Upserts today's totals (idempotent per local date). Ignored before the clock starts and for
 * dates outside the member's 7 challenge days.
 */
export async function recordProgress(memberId, rawChallengeId, input, now = new Date()) {
  const challenge = await challengeForMember(memberId, rawChallengeId, now);
  if (challenge.status === "ended") throw new ApiError(409, "challenge_ended", "This challenge has ended");
  const member = await memberRow(memberId);
  const timeZone = cleanTimeZone(input?.timeZone) ?? member.time_zone;
  await query("update members set time_zone = $2, last_seen_at = $3 where id = $1", [memberId, timeZone, now]);
  if (challenge.status === "waiting") return { accepted: false, reason: "not_started" };

  const checked = validateProgress(input);
  if (!checked.ok) throw new ApiError(400, "bad_progress", checked.error);
  const day = checked.day;
  if (!challengeDates(challenge.starts_at, timeZone, challenge.length_days).includes(day.localDate)) {
    return { accepted: false, reason: "outside_challenge_days" };
  }
  if (day.localDate > localDateIn(now, timeZone)) throw new ApiError(400, "bad_progress", "localDate is in the future");

  const previous = (await query(
    "select outside, new_species from daily_progress where challenge_id = $1 and member_id = $2 and local_date = $3",
    [challenge.id, memberId, day.localDate])).rows[0];
  await query(
    `insert into daily_progress (challenge_id, member_id, local_date, outside, photos, new_species, locked_minutes, emergency_unlocks, steps, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (challenge_id, member_id, local_date) do update set
       outside = excluded.outside, photos = excluded.photos, new_species = excluded.new_species,
       locked_minutes = excluded.locked_minutes, emergency_unlocks = excluded.emergency_unlocks,
       steps = excluded.steps, updated_at = excluded.updated_at`,
    [challenge.id, memberId, day.localDate, day.outside, day.photos, JSON.stringify(day.newSpecies),
     day.lockedMinutes, day.emergencyUnlocks, member.share_steps ? day.steps : null, now],
  );

  // Feed moments: the first verified photo of the day, and each new plant.
  if (day.outside && !previous?.outside) {
    await query("insert into events (challenge_id, member_id, kind, created_at) values ($1, $2, 'outside', $3)",
      [challenge.id, memberId, now]);
    await notify({ kind: "outside", challengeId: challenge.id, from: memberId,
      to: await otherMembers(challenge.id, memberId), data: { nickname: member.nickname } }, now);
  }
  const known = new Set(previous?.new_species ?? []);
  for (const name of day.newSpecies.filter((name) => !known.has(name)).slice(0, 3)) {
    await query("insert into events (challenge_id, member_id, kind, data, created_at) values ($1, $2, 'new_species', $3, $4)",
      [challenge.id, memberId, JSON.stringify({ name }), now]);
  }
  await maybeSendDaySix(memberId, challenge, timeZone, now);
  return { accepted: true };
}

/**
 * "Day 6 of 7: you're 8 points behind Sofie", once, in the evening of the member's day 6. The
 * phone reports progress about hourly, so this needs no per-time-zone cron.
 */
async function maybeSendDaySix(memberId, challenge, timeZone, now) {
  const dates = challengeDates(challenge.starts_at, timeZone, challenge.length_days);
  if (dates.indexOf(localDateIn(now, timeZone)) !== 5) return;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour < LIMITS.daySixHour) return;
  const marked = await query(
    `insert into events (challenge_id, member_id, kind, created_at)
     select $1, $2, 'day6', $3 where not exists
       (select 1 from events where challenge_id = $1 and member_id = $2 and kind = 'day6')`,
    [challenge.id, memberId, now]);
  if (!marked.rowCount) return;
  const view = await board(memberId, challenge.id, now);
  if (view.members.length < 2) return;
  const meEntry = view.members.find((member) => member.isMe);
  const leader = view.members.find((member) => !member.isMe && member.rank === 1) ?? view.members.find((member) => !member.isMe);
  const behind = meEntry.rank === 1 ? 0 : leader.points - meEntry.points;
  await notify({ kind: "day6", challengeId: challenge.id, to: [memberId], data: { behind, leader: leader.nickname } }, now);
}

// MARK: - Board

export async function board(memberId, rawChallengeId, now = new Date()) {
  const challenge = await challengeForMember(memberId, rawChallengeId, now);
  const crew = (await query(
    `select m.id, m.nickname, m.colour, m.share_steps, m.time_zone, cm.joined_at
       from challenge_members cm join members m on m.id = cm.member_id
      where cm.challenge_id = $1 and not cm.removed order by cm.joined_at`,
    [challenge.id])).rows;
  const progress = (await query(
    "select * from daily_progress where challenge_id = $1", [challenge.id])).rows;
  const me = crew.find((row) => row.id === memberId);
  await query("update members set last_seen_at = $2 where id = $1", [memberId, now]);

  const started = challenge.status !== "waiting";
  const entries = crew.map((row) => {
    const dates = started ? challengeDates(challenge.starts_at, row.time_zone, challenge.length_days) : [];
    const mine = progress
      .filter((p) => p.member_id === row.id && dates.includes(isoDate(p.local_date)))
      .map((p) => ({
        localDate: isoDate(p.local_date), outside: p.outside, photos: p.photos, newSpecies: p.new_species,
        lockedMinutes: p.locked_minutes, emergencyUnlocks: p.emergency_unlocks, steps: row.share_steps ? p.steps : null,
      }));
    return { memberId: row.id, joinedAt: row.joined_at, days: mine, row, dates };
  });
  const ranked = rank(entries);

  const members = ranked.map(({ memberId: id, score, rank: place, days, row, dates }) => {
    const today = localDateIn(now, row.time_zone);
    const byDate = new Map(days.map((day) => [day.localDate, day]));
    const dots = dates.map((date) => {
      const day = byDate.get(date);
      if (day?.outside) return "outside";
      if (day?.steps != null && day.steps >= LIMITS.stepsOnlyDay) return "steps";
      if (date === today && challenge.status === "active") return "open";
      return date > today ? "future" : "none";
    });
    return {
      memberId: id,
      nickname: row.nickname,
      colour: row.colour,
      isMe: id === memberId,
      isCreator: id === challenge.creator_id,
      rank: place,
      points: score.points,
      daysOutside: score.daysOutside,
      newSpecies: score.newSpecies,
      photos: score.photos,
      lockedHours: score.lockedHours,
      emergencyUnlocks: score.emergencyUnlocks,
      days: dots,
      streak: streak(dates, byDate, today),
    };
  });

  const feed = (await query(
    `select e.kind, e.data, e.created_at, m.nickname, m.colour from events e left join members m on m.id = e.member_id
      where e.challenge_id = $1 and e.kind in ('joined', 'outside', 'new_species', 'cheer', 'started', 'left')
      order by e.created_at desc, e.id desc limit $2`,
    [challenge.id, LIMITS.feedItems])).rows.map((row) => ({
      kind: row.kind, nickname: row.nickname, colour: row.colour, data: row.data, at: row.created_at.toISOString(),
    }));

  const myDates = started ? challengeDates(challenge.starts_at, me.time_zone, challenge.length_days) : [];
  const myToday = localDateIn(now, me.time_zone);
  const dayNumber = challenge.status === "ended" ? challenge.length_days
    : started ? Math.min(challenge.length_days, Math.max(1, myDates.indexOf(myToday) + 1 || challenge.length_days)) : 0;

  return {
    challenge: {
      id: challenge.id,
      code: challenge.code,
      status: challenge.status,
      lengthDays: challenge.length_days,
      day: dayNumber,
      startsAt: challenge.starts_at?.toISOString() ?? null,
      endsAt: challenge.ends_at?.toISOString() ?? null,
    },
    goal: {
      daysOutside: members.reduce((sum, member) => sum + member.daysOutside, 0),
      target: LIMITS.goalDaysPerMember * members.length,
    },
    members,
    feed,
  };
}

function isoDate(value) {
  return String(value).slice(0, 10);  // db.js keeps dates as "YYYY-MM-DD"
}

/** Days outside in a row, up to today (today still counts as open). */
function streak(dates, byDate, today) {
  let count = 0;
  for (let i = dates.indexOf(today) === -1 ? dates.length - 1 : dates.indexOf(today); i >= 0; i--) {
    if (byDate.get(dates[i])?.outside) count++;
    else if (dates[i] !== today) break;
  }
  return count;
}

// MARK: - Cheer and nudge

export async function cheer(memberId, rawChallengeId, input, now = new Date()) {
  const challenge = await challengeForMember(memberId, rawChallengeId, now);
  if (challenge.status !== "active") throw new ApiError(409, "not_active", "The challenge isn't running");
  const kind = input?.kind;
  if (kind !== "cheer" && kind !== "nudge") throw new ApiError(400, "bad_kind");
  const to = requireUuid(input?.to, "member");
  if (to === memberId) throw new ApiError(400, "not_yourself");
  const crew = await otherMembers(challenge.id, memberId);
  if (!crew.includes(to)) throw new ApiError(404, "member_not_found");

  const sender = await memberRow(memberId);
  const localDate = localDateIn(now, sender.time_zone);
  if (kind === "cheer") {
    const { rows } = await query(
      `select count(*)::int as n from cheers where challenge_id = $1 and from_member = $2 and to_member = $3
        and kind = 'cheer' and local_date = $4`, [challenge.id, memberId, to, localDate]);
    if (rows[0].n >= LIMITS.cheersPerPairPerDay) throw new ApiError(429, "too_many_cheers");
  }
  const inserted = await query(
    `insert into cheers (challenge_id, from_member, to_member, kind, local_date, created_at)
     values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
    [challenge.id, memberId, to, kind, localDate, now]);
  if (!inserted.rowCount) throw new ApiError(429, "already_nudged", "One nudge a day per friend");
  await query("insert into events (challenge_id, member_id, kind, data, created_at) values ($1, $2, $3, $4, $5)",
    [challenge.id, memberId, kind, JSON.stringify({ to }), now]);
  await notify({ kind, challengeId: challenge.id, from: memberId, to: [to], data: { nickname: sender.nickname } }, now);
  return { sent: true };
}

// MARK: - Leave and remove

/** Leave (yourself) or remove someone (creator only). Leaving deletes your progress. */
export async function removeMember(actorId, rawChallengeId, rawTargetId, now = new Date()) {
  const challenge = await challengeForMember(actorId, rawChallengeId, now);
  const targetId = requireUuid(rawTargetId, "member");
  return transaction(async (client) => {
    if (targetId === actorId) {
      await client.query("delete from challenge_members where challenge_id = $1 and member_id = $2", [challenge.id, actorId]);
      const left = await crewCount(challenge.id, client);
      if (left === 0) {
        await client.query("delete from challenges where id = $1", [challenge.id]);
        return { left: true };
      }
      await client.query("insert into events (challenge_id, kind, created_at) values ($1, 'left', $2)", [challenge.id, now]);
      if (challenge.creator_id === actorId) {
        // The longest-standing member takes over.
        await client.query(
          `update challenges set creator_id = (select member_id from challenge_members
             where challenge_id = $1 and not removed order by joined_at limit 1) where id = $1`, [challenge.id]);
      }
      return { left: true };
    }
    if (challenge.creator_id !== actorId) throw new ApiError(403, "creator_only", "Only the creator can remove people");
    const { rowCount } = await client.query(
      "update challenge_members set removed = true where challenge_id = $1 and member_id = $2 and not removed",
      [challenge.id, targetId]);
    if (!rowCount) throw new ApiError(404, "member_not_found");
    await client.query("delete from daily_progress where challenge_id = $1 and member_id = $2", [challenge.id, targetId]);
    await client.query("delete from events where challenge_id = $1 and member_id = $2", [challenge.id, targetId]);
    return { removed: true };
  });
}
