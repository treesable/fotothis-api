import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import { _resetSent, results, sent } from "../lib/challenges/notify.js";
import { _resetTokenCache, isQuietHours, messageFor, providerToken, pushTo, transport } from "../lib/challenges/push.js";
import { createChallenge, createMember, join, recordProgress } from "../lib/challenges/service.js";
import { store } from "../lib/store.js";
import { _closeForTests, freshDatabase, query, skipWithoutDatabase } from "./db-helpers.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const realSend = transport.send;
let deliveries;

beforeEach(async () => {
  process.env.APNS_KEY_ID = "ABC123DEFG";
  process.env.APNS_TEAM_ID = "J72XXRT45L";
  process.env.APNS_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
  process.env.MEMBER_KEY = "k".repeat(64);
  _resetTokenCache();
  _resetSent();
  store._clearMemory();
  deliveries = [];
  transport.send = async (request) => { deliveries.push(request); return { status: 200, reason: null }; };
  if (!skipWithoutDatabase) await freshDatabase();
});
after(async () => {
  transport.send = realSend;
  if (!skipWithoutDatabase) await _closeForTests();
});

// 14:00 in Copenhagen (CEST).
const afternoon = new Date("2026-10-20T12:00:00Z");
const member = (overrides = {}) => ({ id: "m1", apns_token: "ab".repeat(32), apns_sandbox: false, time_zone: "Europe/Copenhagen", ...overrides });
const send = (m = member(), message = { kind: "cheer", challengeId: "c1", data: { nickname: "Sofie" } }, options = {}) =>
  pushTo(m, message, { now: afternoon, localDate: "2026-10-20", ...options });

test("the provider token is an ES256 JWT signed with the .p8 key", () => {
  const token = providerToken(afternoon.getTime());
  const [header, claims, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "ES256", kid: "ABC123DEFG" });
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url")), { iss: "J72XXRT45L", iat: afternoon.getTime() / 1000 });
  assert.equal(verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url")), true);
  assert.equal(providerToken(afternoon.getTime() + 49 * 60_000), token, "Reused for 50 minutes");
  assert.notEqual(providerToken(afternoon.getTime() + 51 * 60_000), token);
});

test("a cheer goes to Apple with the right headers and payload", async () => {
  assert.equal(await send(), "sent");
  const [delivery] = deliveries;
  assert.equal(delivery.sandbox, false);
  assert.equal(delivery.deviceToken, "ab".repeat(32));
  assert.equal(delivery.headers["apns-topic"], "com.treesable.fotothis");
  assert.equal(delivery.headers["apns-push-type"], "alert");
  assert.match(delivery.headers.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  assert.deepEqual(delivery.payload.aps.alert, { title: "Outside Challenge", body: "Sofie cheered you on" });
  assert.equal(delivery.payload.challengeId, "c1");
  assert.equal(delivery.payload.kind, "cheer");
  assert.equal(await send(member({ apns_sandbox: true })), "sent");
  assert.equal(deliveries[1].sandbox, true, "Builds from Xcode push through the sandbox");
});

test("quiet hours 21:30–08:00 in the member's own time zone", async () => {
  const at = (iso) => new Date(iso);
  assert.equal(isQuietHours(at("2026-10-20T19:29:00Z"), "Europe/Copenhagen"), false, "21:29");
  assert.equal(isQuietHours(at("2026-10-20T19:30:00Z"), "Europe/Copenhagen"), true, "21:30");
  assert.equal(isQuietHours(at("2026-10-21T05:59:00Z"), "Europe/Copenhagen"), true, "07:59");
  assert.equal(isQuietHours(at("2026-10-21T06:00:00Z"), "Europe/Copenhagen"), false, "08:00");
  assert.equal(isQuietHours(at("2026-10-20T19:30:00Z"), "America/New_York"), false, "15:30 in New York");
  assert.equal(await send(member(), undefined, { now: at("2026-10-20T21:00:00Z") }), "skipped:quiet_hours");
  assert.equal(deliveries.length, 0);
});

test("at most 3 pushes a day per person", async () => {
  for (let i = 0; i < 3; i++) assert.equal(await send(), "sent");
  assert.equal(await send(), "skipped:daily_limit");
  assert.equal(await send(member({ id: "m2" })), "sent", "Per person");
  assert.equal(await send(member(), undefined, { localDate: "2026-10-21" }), "sent", "New day");
});

test("no key, no token, a dead token", async () => {
  delete process.env.APNS_PRIVATE_KEY;
  assert.equal(await send(), "skipped:not_configured");
  process.env.APNS_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
  assert.equal(await send(member({ apns_token: null })), "skipped:no_token");
  transport.send = async () => ({ status: 410, reason: "Unregistered" });
  let cleared = false;
  assert.equal(await send(member(), undefined, { onBadToken: () => { cleared = true; } }), "failed:Unregistered");
  assert.equal(cleared, true);
});

test("the wording for every moment", () => {
  assert.equal(messageFor("joined", { nickname: "Sofie" }).body, "Sofie joined your challenge");
  assert.equal(messageFor("outside", { nickname: "Sofie" }).body, "Sofie just went outside");
  assert.equal(messageFor("nudge").body, "Your crew is outside. Join them!");
  assert.deepEqual(messageFor("day6", { behind: 8, leader: "Sofie" }), { title: "Day 6 of 7", body: "You're 8 points behind Sofie" });
  assert.equal(messageFor("day6", { behind: 1, leader: "Sofie" }).body, "You're 1 point behind Sofie");
  assert.equal(messageFor("day6", { behind: 0, leader: "Sofie" }).body, "You're in the lead. One more day!");
  assert.deepEqual(messageFor("complete"), { title: "Challenge complete!", body: "See who won" });
  assert.equal(messageFor("unknown"), null);
});

test("day 6, in the evening: how far behind the leader, once", { skip: skipWithoutDatabase }, async () => {
  const t0 = new Date("2026-10-20T08:00:00Z");  // 10:00 in Copenhagen
  const zone = { colour: "#8FD19E", timeZone: "Europe/Copenhagen", apnsToken: "cd".repeat(32) };
  const marcel = await createMember({ nickname: "Marcel", ...zone }, t0);
  const sofie = await createMember({ nickname: "Sofie", ...zone }, t0);
  const { id, code } = await createChallenge(marcel.memberId, t0);
  await join(sofie.memberId, code, {}, t0);
  const day = (localDate, photos) => ({ localDate, outside: photos > 0, photos, newSpecies: [], lockedMinutes: 0,
    emergencyUnlocks: 0, timeZone: "Europe/Copenhagen" });
  await recordProgress(sofie.memberId, id, day("2026-10-20", 3), t0);  // Sofie: 16 points

  _resetSent();
  const dayFiveEvening = new Date("2026-10-24T17:00:00Z");
  await recordProgress(marcel.memberId, id, day("2026-10-24", 1), dayFiveEvening);
  assert.equal(sent.some((m) => m.kind === "day6"), false, "Not on day 5");
  const daySixMorning = new Date("2026-10-25T08:00:00Z");
  await recordProgress(marcel.memberId, id, day("2026-10-25", 0), daySixMorning);
  assert.equal(sent.some((m) => m.kind === "day6"), false, "Not before 18:00");

  const daySixEvening = new Date("2026-10-25T17:30:00Z");  // 18:30 (CET after the clock change)
  await recordProgress(marcel.memberId, id, day("2026-10-25", 0), daySixEvening);
  const daySix = sent.filter((m) => m.kind === "day6");
  assert.deepEqual(daySix.map((m) => [m.to[0], m.data]), [[marcel.memberId, { behind: 4, leader: "Sofie" }]]);
  assert.deepEqual(results.filter((r) => r.kind === "day6").map((r) => r.result), ["sent"]);
  await recordProgress(marcel.memberId, id, day("2026-10-25", 0), new Date("2026-10-25T18:30:00Z"));
  assert.equal(sent.filter((m) => m.kind === "day6").length, 1, "Once");
  assert.equal((await query("select count(*)::int as n from events where kind = 'day6'")).rows[0].n, 1);
});
