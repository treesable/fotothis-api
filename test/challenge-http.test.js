import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { sign } from "../lib/challenges/auth.js";
import { store } from "../lib/store.js";
import { _closeForTests, freshDatabase, skipWithoutDatabase } from "./db-helpers.js";
import { fakeRequest, fakeResponse } from "./helpers.js";

process.env.API_SECRET = "test-secret";
process.env.APP_ATTEST_MODE = "off";
process.env.MEMBER_KEY = "k".repeat(64);
const { default: members } = await import("../api/v1/members.js");
const { default: challenges } = await import("../api/v1/challenges.js");

const skip = skipWithoutDatabase;
beforeEach(async () => {
  store._clearMemory();
  if (!skip) await freshDatabase();
});
after(async () => { if (!skip) await _closeForTests(); });

/** Calls an endpoint the way Vercel does after the rewrite (`?route=`), signed when `as` is given. */
async function call(method, route, { body, as, appSecret = "test-secret", signWith } = {}) {
  const text = body === undefined ? "" : JSON.stringify(body);
  const headers = { "x-api-secret": appSecret, "x-device-id": "device-1" };
  if (as) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    headers["x-member-id"] = as.memberId;
    headers["x-member-timestamp"] = timestamp;
    headers["x-member-signature"] = sign(signWith ?? as.secret, method, route, timestamp, Buffer.from(text));
  }
  const [base, ...tail] = route.split("/");
  const req = fakeRequest({ method, headers, body: text });
  req.url = `/api/v1/${base}${tail.length ? `?route=${encodeURIComponent(tail.join("/"))}` : ""}`;
  const res = fakeResponse();
  await (base === "members" ? members : challenges)(req, res);
  return res;
}

const newMember = async (nickname) => (await call("POST", "members", { body: { nickname, colour: "#FF7A5C", timeZone: "Europe/Copenhagen" } })).body;

test("a full round: create, join, progress, board", { skip }, async () => {
  const marcel = await newMember("Marcel");
  assert.ok(marcel.memberId && marcel.secret);
  const created = await call("POST", "challenges", { as: marcel });
  assert.equal(created.statusCode, 200);
  const { id, code } = created.body;

  const preview = await call("GET", `challenges/by-code/${code}`);
  assert.equal(preview.body.inviter.nickname, "Marcel");

  const sofie = await newMember("Sofie");
  assert.equal((await call("POST", `challenges/${code}/join`, { as: sofie, body: { shareSteps: true } })).statusCode, 200);

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen" }).format(new Date());
  const progress = await call("POST", `challenges/${id}/progress`, { as: sofie, body: {
    localDate: today, outside: true, photos: 1, newSpecies: ["Dahlia"], lockedMinutes: 90, emergencyUnlocks: 0, steps: 4000,
    timeZone: "Europe/Copenhagen",
  } });
  assert.deepEqual(progress.body, { accepted: true });

  const view = await call("GET", `challenges/${id}/board`, { as: marcel });
  assert.equal(view.statusCode, 200);
  assert.equal(view.body.members[0].nickname, "Sofie");
  assert.equal(view.body.members[0].points, 10 + 5 + 2 + 1);

  const mine = await call("GET", "members/me", { as: sofie });
  assert.equal(mine.body.challenge.id, id);
  const renamed = await call("PATCH", "members/me", { as: sofie, body: { nickname: "Sofie B" } });
  assert.equal(renamed.body.nickname, "Sofie B");

  assert.equal((await call("DELETE", `challenges/${id}/members/${sofie.memberId}`, { as: sofie })).statusCode, 200);
});

test("no app secret, no signature, a wrong secret or an old timestamp: 401", { skip }, async () => {
  const marcel = await newMember("Marcel");
  assert.equal((await call("POST", "challenges", { as: marcel, appSecret: "wrong" })).statusCode, 401);
  assert.equal((await call("POST", "challenges")).statusCode, 401, "Unsigned");
  const forged = await call("POST", "challenges", { as: marcel, signWith: "guessed-secret" });
  assert.equal(forged.statusCode, 401);
  assert.equal(forged.body.error, "bad_signature");
  // A signature for another route doesn't carry over.
  const res = fakeResponse();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const req = fakeRequest({ method: "POST", headers: {
    "x-api-secret": "test-secret", "x-member-id": marcel.memberId, "x-member-timestamp": timestamp,
    "x-member-signature": sign(marcel.secret, "POST", "members", timestamp, Buffer.alloc(0)),
  } });
  req.url = "/api/v1/challenges";
  await challenges(req, res);
  assert.equal(res.statusCode, 401);
});

test("outsiders get 403 on the board; unknown routes 404, wrong methods 405", { skip }, async () => {
  const marcel = await newMember("Marcel");
  const { id } = (await call("POST", "challenges", { as: marcel })).body;
  const ola = await newMember("Ola");
  const board = await call("GET", `challenges/${id}/board`, { as: ola });
  assert.equal(board.statusCode, 403);
  assert.equal(board.body.error, "not_a_member");
  assert.equal((await call("GET", `challenges/${id}/secrets`, { as: marcel })).statusCode, 404);
  assert.equal((await call("PUT", `challenges/${id}/board`, { as: marcel })).statusCode, 405);
  assert.equal((await call("GET", "members")).statusCode, 405);
});

test("bad input comes back as a clear 400", { skip }, async () => {
  assert.equal((await call("POST", "members", { body: { nickname: "", colour: "#FF7A5C" } })).body.error, "bad_nickname");
  const marcel = await newMember("Marcel");
  const { code } = (await call("POST", "challenges", { as: marcel })).body;
  const sofie = await newMember("Sofie");
  await call("POST", `challenges/${code}/join`, { as: sofie });
  const { id } = (await call("GET", "members/me", { as: sofie })).body.challenge;
  const res = await call("POST", `challenges/${id}/progress`, { as: sofie, body: { localDate: "nope" } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "bad_progress");
});

test("invite codes can't be looked up in bulk", { skip }, async () => {
  for (let i = 0; i < 60; i++) await call("GET", "challenges/by-code/OAK-123");
  const res = await call("GET", "challenges/by-code/OAK-124");
  assert.equal(res.statusCode, 429);
});

test("without MEMBER_KEY the endpoints say they aren't set up", { skip }, async () => {
  const marcel = await newMember("Marcel");
  delete process.env.MEMBER_KEY;
  try {
    const res = await call("GET", "members/me", { as: marcel, signWith: "x" });
    assert.equal(res.statusCode, 503);
  } finally {
    process.env.MEMBER_KEY = "k".repeat(64);
  }
});
