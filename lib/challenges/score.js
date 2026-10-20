// Outside Challenge points (docs/CHALLENGES.md in the app repo, "Points"). Pure: no database,
// no clock. The board, the ranking and the final result all come from these functions, so the
// rules live in one place and are unit-tested.

export const RULES = {
  dayOutside: 10,
  newSpecies: 5,
  photo: 2,
  lockedHour: 1,
  emergencyUnlock: -10,
  maxLockedHoursPerDay: 16,
  // Impossible values (the app enforces these; a fake client can't go past them).
  maxPhotosPerDay: 6,
  maxEmergencyUnlocksPerDay: 1,
  maxLockedMinutesPerDay: 24 * 60,
  maxSteps: 100_000,
  maxSpeciesNameLength: 80,
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isCount = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;

/**
 * Checks one day's totals as the phone sends them. Returns `{ ok: true, day }` with a clean copy,
 * or `{ ok: false, error }`.
 */
export function validateProgress(input) {
  if (!input || typeof input !== "object") return fail("Progress must be an object");
  const { localDate, outside, photos, newSpecies = [], lockedMinutes, emergencyUnlocks, steps = null } = input;

  if (typeof localDate !== "string" || !DATE.test(localDate) || Number.isNaN(Date.parse(`${localDate}T00:00:00Z`))) {
    return fail("localDate must be YYYY-MM-DD");
  }
  if (typeof outside !== "boolean") return fail("outside must be true or false");
  if (!isCount(photos, RULES.maxPhotosPerDay)) return fail(`photos must be 0–${RULES.maxPhotosPerDay}`);
  // "A day outside" = at least one verified photo that day.
  if (outside !== photos > 0) return fail("outside must match photos");
  if (!Array.isArray(newSpecies) || newSpecies.length > photos) return fail("newSpecies can't exceed photos");
  if (!newSpecies.every((name) => typeof name === "string" && name.trim().length > 0 && name.length <= RULES.maxSpeciesNameLength)) {
    return fail("newSpecies must be common names");
  }
  if (!isCount(lockedMinutes, RULES.maxLockedMinutesPerDay)) return fail("lockedMinutes must be 0–1440");
  if (!isCount(emergencyUnlocks, RULES.maxEmergencyUnlocksPerDay)) return fail("emergencyUnlocks must be 0 or 1");
  if (steps !== null && !isCount(steps, RULES.maxSteps)) return fail(`steps must be 0–${RULES.maxSteps} or null`);

  return {
    ok: true,
    day: {
      localDate,
      outside,
      photos,
      newSpecies: newSpecies.map((name) => name.trim()),
      lockedMinutes,
      emergencyUnlocks,
      steps,
    },
  };
}

/** One day's parts and points. Locked time counts in full hours, at most 16 a day. */
export function dayScore(day) {
  const lockedHours = Math.min(Math.floor(day.lockedMinutes / 60), RULES.maxLockedHoursPerDay);
  const parts = {
    daysOutside: day.outside ? 1 : 0,
    newSpecies: day.newSpecies.length,
    photos: day.photos,
    lockedHours,
    emergencyUnlocks: day.emergencyUnlocks,
  };
  return { ...parts, points: pointsFor(parts) };
}

function pointsFor({ daysOutside, newSpecies, photos, lockedHours, emergencyUnlocks }) {
  return daysOutside * RULES.dayOutside
    + newSpecies * RULES.newSpecies
    + photos * RULES.photo
    + lockedHours * RULES.lockedHour
    + emergencyUnlocks * RULES.emergencyUnlock;
}

/**
 * A member's totals over the challenge. Days are unique per local date (the last one sent wins),
 * so a re-sent day never counts twice.
 */
export function challengeScore(days) {
  const byDate = new Map();
  for (const day of days) byDate.set(day.localDate, day);
  const totals = { daysOutside: 0, newSpecies: 0, photos: 0, lockedHours: 0, emergencyUnlocks: 0, points: 0 };
  for (const day of byDate.values()) {
    const score = dayScore(day);
    for (const key of Object.keys(totals)) totals[key] += score[key];
  }
  return totals;
}

/**
 * The ranking: points, then more days outside, then more new plants, then who joined first.
 * `members`: [{ memberId, joinedAt (Date or ISO string), days: [...] }]. Returns them with
 * `score` and `rank` (1-based; ties are broken, so ranks are unique).
 */
export function rank(members) {
  return members
    .map((member) => ({ ...member, score: challengeScore(member.days) }))
    .sort((a, b) =>
      b.score.points - a.score.points
      || b.score.daysOutside - a.score.daysOutside
      || b.score.newSpecies - a.score.newSpecies
      || new Date(a.joinedAt) - new Date(b.joinedAt))
    .map((member, index) => ({ ...member, rank: index + 1 }));
}

function fail(error) {
  return { ok: false, error };
}
