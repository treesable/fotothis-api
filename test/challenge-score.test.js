import assert from "node:assert/strict";
import { test } from "node:test";
import { RULES, challengeScore, dayScore, rank, validateProgress } from "../lib/challenges/score.js";

const day = (overrides = {}) => ({
  localDate: "2026-10-20", outside: false, photos: 0, newSpecies: [], lockedMinutes: 0, emergencyUnlocks: 0, steps: null,
  ...overrides,
});

test("a day outside is +10", () => {
  assert.equal(dayScore(day({ outside: true, photos: 1 })).points, 10 + 2);
  assert.equal(dayScore(day()).points, 0, "No photo, no day outside");
});

test("each new plant species is +5", () => {
  assert.equal(dayScore(day({ outside: true, photos: 2, newSpecies: ["Oak", "Daisy"] })).points, 10 + 2 * 2 + 2 * 5);
});

test("each verified photo is +2", () => {
  assert.equal(dayScore(day({ outside: true, photos: 6 })).points, 10 + 12);
});

test("each full locked hour is +1, at most 16 a day", () => {
  assert.equal(dayScore(day({ lockedMinutes: 59 })).points, 0, "Not a full hour");
  assert.equal(dayScore(day({ lockedMinutes: 125 })).points, 2);
  assert.equal(dayScore(day({ lockedMinutes: 16 * 60 })).lockedHours, 16);
  assert.equal(dayScore(day({ lockedMinutes: 24 * 60 })).lockedHours, 16, "Sleep doesn't dominate");
});

test("an emergency unlock is -10, and a day can go negative", () => {
  assert.equal(dayScore(day({ emergencyUnlocks: 1 })).points, -10);
  assert.equal(dayScore(day({ outside: true, photos: 1, emergencyUnlocks: 1, lockedMinutes: 180 })).points, 10 + 2 - 10 + 3);
});

test("the spec's example adds up", () => {
  // 4 days outside, 3 new plants, 6 photos, 31 h locked, no emergency unlock = 40 + 15 + 12 + 31 = 98.
  const days = [
    day({ localDate: "2026-10-20", outside: true, photos: 2, newSpecies: ["Oak"], lockedMinutes: 8 * 60 }),
    day({ localDate: "2026-10-21", outside: true, photos: 1, newSpecies: ["Daisy"], lockedMinutes: 7 * 60 }),
    day({ localDate: "2026-10-22", outside: true, photos: 2, newSpecies: ["Birch"], lockedMinutes: 8 * 60 }),
    day({ localDate: "2026-10-23", outside: true, photos: 1, lockedMinutes: 8 * 60 + 30 }),
  ];
  const score = challengeScore(days);
  assert.deepEqual(score, {
    daysOutside: 4, walkDays: 0, newSpecies: 3, photos: 6, lockedHours: 31, emergencyUnlocks: 0, lockChangeDays: 0, locksOffDays: 0, points: 98,
  });
});

test("a walk day (no photo, 5,000+ steps) is worth 5; fewer steps or hidden steps, nothing", () => {
  assert.equal(dayScore(day({ outside: false, photos: 0, steps: 5_000 })).points, 5);
  assert.equal(dayScore(day({ outside: false, photos: 0, steps: 4_999 })).points, 0);
  assert.equal(dayScore(day({ outside: false, photos: 0, steps: null })).points, 0);
  // A photo day is a photo day, however far you walked.
  assert.equal(dayScore(day({ outside: true, photos: 1, steps: 12_000 })).points, 10 + 2);
  const score = challengeScore([
    day({ localDate: "2026-10-20", outside: false, photos: 0, steps: 8_000 }),
    day({ localDate: "2026-10-21", outside: true, photos: 1 }),
  ]);
  assert.deepEqual([score.walkDays, score.daysOutside, score.points], [1, 1, 5 + 10 + 2]);
});

test("a day sent twice counts once (the last one wins)", () => {
  const score = challengeScore([
    day({ outside: true, photos: 1 }),
    day({ outside: true, photos: 3 }),
  ]);
  assert.equal(score.daysOutside, 1);
  assert.equal(score.photos, 3);
});

test("ranking: points first", () => {
  const ranked = rank([
    { memberId: "a", joinedAt: "2026-10-20T10:00:00Z", days: [day({ outside: true, photos: 1 })] },
    { memberId: "b", joinedAt: "2026-10-20T11:00:00Z", days: [day({ outside: true, photos: 2 })] },
  ]);
  assert.deepEqual(ranked.map((m) => [m.memberId, m.rank]), [["b", 1], ["a", 2]]);
});

test("ties: more days outside first", () => {
  // a: 1 day outside with 1 photo, then 18 h locked (capped at 16) = 10 + 2 + 16 = 28.
  const a = [day({ localDate: "2026-10-20", outside: true, photos: 1 }), day({ localDate: "2026-10-21", lockedMinutes: 18 * 60 })];
  // b: two days outside with 1 photo each = 24, plus 4 locked hours = 28.
  const b = [
    day({ localDate: "2026-10-20", outside: true, photos: 1, lockedMinutes: 2 * 60 }),
    day({ localDate: "2026-10-21", outside: true, photos: 1, lockedMinutes: 2 * 60 }),
  ];
  const ranked = rank([
    { memberId: "a", joinedAt: "2026-10-20T10:00:00Z", days: a },
    { memberId: "b", joinedAt: "2026-10-20T11:00:00Z", days: b },
  ]);
  assert.equal(ranked[0].score.points, ranked[1].score.points);
  assert.deepEqual(ranked.map((m) => m.memberId), ["b", "a"]);
});

test("ties: then more new plants", () => {
  // a: 1 day, 1 photo, 1 new plant = 17. b: 1 day, 1 photo, 5 locked hours = 17.
  const ranked = rank([
    { memberId: "b", joinedAt: "2026-10-20T10:00:00Z", days: [day({ outside: true, photos: 1, lockedMinutes: 5 * 60 })] },
    { memberId: "a", joinedAt: "2026-10-20T11:00:00Z", days: [day({ outside: true, photos: 1, newSpecies: ["Oak"] })] },
  ]);
  assert.equal(ranked[0].score.points, 17);
  assert.equal(ranked[1].score.points, 17);
  assert.deepEqual(ranked.map((m) => m.memberId), ["a", "b"]);
});

test("ties: then who joined first", () => {
  const same = [day({ outside: true, photos: 1 })];
  const ranked = rank([
    { memberId: "late", joinedAt: "2026-10-21T09:00:00Z", days: same },
    { memberId: "early", joinedAt: "2026-10-20T09:00:00Z", days: same },
  ]);
  assert.deepEqual(ranked.map((m) => [m.memberId, m.rank]), [["early", 1], ["late", 2]]);
});

test("no days yet: 0 points, still ranked", () => {
  const ranked = rank([{ memberId: "new", joinedAt: "2026-10-20T09:00:00Z", days: [] }]);
  assert.equal(ranked[0].score.points, 0);
  assert.equal(ranked[0].rank, 1);
});

test("lock marks are counted but cost no points", () => {
  const marked = dayScore(day({ outside: true, photos: 1, lockChanges: 1, locksOff: 1 }));
  assert.equal(marked.points, 10 + 2);
  assert.equal(marked.lockChangeDays, 1);
  assert.equal(marked.locksOffDays, 1);
  const score = challengeScore([
    day({ localDate: "2026-10-20", lockChanges: 1 }),
    day({ localDate: "2026-10-21", lockChanges: 1, locksOff: 1 }),
    day({ localDate: "2026-10-21", lockChanges: 1, locksOff: 1 }),
  ]);
  assert.equal(score.lockChangeDays, 2, "One mark per day, a re-sent day counts once");
  assert.equal(score.locksOffDays, 1);
  assert.equal(score.points, 0);
});

test("lock marks are optional for older app builds", () => {
  const result = validateProgress({ localDate: "2026-10-20", outside: false, photos: 0, lockedMinutes: 0, emergencyUnlocks: 0 });
  assert.equal(result.day.lockChanges, 0);
  assert.equal(result.day.locksOff, 0);
  assert.equal(dayScore({ ...result.day, lockChanges: undefined, locksOff: undefined }).lockChangeDays, 0, "Old rows without the fields");
});

test("valid progress passes and is cleaned", () => {
  const result = validateProgress({
    localDate: "2026-10-20", outside: true, photos: 2, newSpecies: [" Common Oak "], lockedMinutes: 300, emergencyUnlocks: 0, steps: 8412,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.day.newSpecies, ["Common Oak"]);
  assert.equal(validateProgress({ localDate: "2026-10-20", outside: false, photos: 0, lockedMinutes: 0, emergencyUnlocks: 0 }).ok, true,
    "Steps and species are optional");
});

test("impossible values are refused", () => {
  const base = { localDate: "2026-10-20", outside: true, photos: 1, newSpecies: [], lockedMinutes: 0, emergencyUnlocks: 0, steps: null };
  const bad = {
    "photos over the daily limit": { photos: RULES.maxPhotosPerDay + 1 },
    "negative photos": { photos: -1, outside: false },
    "fractional photos": { photos: 1.5 },
    "outside without a photo": { outside: true, photos: 0 },
    "a photo but not outside": { outside: false, photos: 1 },
    "more new plants than photos": { newSpecies: ["A", "B"] },
    "an empty species name": { newSpecies: [" "] },
    "a non-string species": { newSpecies: [42] },
    "more than 24 h locked": { lockedMinutes: 24 * 60 + 1 },
    "negative locked time": { lockedMinutes: -5 },
    "two emergency unlocks": { emergencyUnlocks: 2 },
    "two lock changes": { lockChanges: 2 },
    "lock changes as a boolean": { lockChanges: true },
    "negative locks off": { locksOff: -1 },
    "steps over 100,000": { steps: 100_001 },
    "negative steps": { steps: -1 },
    "a bad date": { localDate: "20-10-2026" },
    "an impossible date": { localDate: "2026-13-40" },
    "outside as a string": { outside: "yes" },
  };
  for (const [name, change] of Object.entries(bad)) {
    assert.equal(validateProgress({ ...base, ...change }).ok, false, name);
  }
  assert.equal(validateProgress(null).ok, false);
});
