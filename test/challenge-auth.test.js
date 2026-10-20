import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { secretFor, sign, verifyMember } from "../lib/challenges/auth.js";
import { generateCode, normalizeCode, WORDS } from "../lib/challenges/codes.js";
import { fakeRequest } from "./helpers.js";

beforeEach(() => { process.env.MEMBER_KEY = "k".repeat(64); });
const id = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const now = Date.parse("2026-10-20T12:00:00Z");
const ts = String(now / 1000);

function signed({ memberId = id, method = "POST", route = "challenges/x/progress", body = '{"a":1}', at = ts, secret } = {}) {
  const signature = sign(secret ?? secretFor(memberId), method, route, at, Buffer.from(body));
  return fakeRequest({ method, body, headers: { "x-member-id": memberId, "x-member-timestamp": at, "x-member-signature": signature } });
}

test("a correctly signed request identifies the member", () => {
  assert.equal(verifyMember(signed(), "challenges/x/progress", Buffer.from('{"a":1}'), now), id);
});

test("the secret is per member and comes from MEMBER_KEY", () => {
  assert.notEqual(secretFor(id), secretFor("00000000-0000-4000-8000-000000000000"));
  const before = secretFor(id);
  process.env.MEMBER_KEY = "z".repeat(64);
  assert.notEqual(secretFor(id), before);
});

test("tampering, other routes, old timestamps and wrong secrets fail", () => {
  const route = "challenges/x/progress";
  assert.equal(verifyMember(signed(), route, Buffer.from('{"a":2}'), now), null, "Other body");
  assert.equal(verifyMember(signed(), "challenges/y/progress", Buffer.from('{"a":1}'), now), null, "Other route");
  const signedAsGet = signed({ method: "GET" });
  signedAsGet.method = "POST";
  assert.equal(verifyMember(signedAsGet, route, Buffer.from('{"a":1}'), now), null, "Signed as GET, sent as POST");
  assert.equal(verifyMember(signed({ at: String(now / 1000 - 301) }), route, Buffer.from('{"a":1}'), now), null, "Too old");
  assert.equal(verifyMember(signed({ secret: "guess" }), route, Buffer.from('{"a":1}'), now), null, "Wrong secret");
  assert.equal(verifyMember(signed({ memberId: "not-a-uuid" }), route, Buffer.from('{"a":1}'), now), null, "Bad id");
  assert.equal(verifyMember(fakeRequest({ body: '{"a":1}' }), route, Buffer.from('{"a":1}'), now), null, "No headers");
});

test("without MEMBER_KEY nothing verifies", () => {
  delete process.env.MEMBER_KEY;
  assert.throws(() => secretFor(id), /MEMBER_KEY/);
});

test("codes look like OAK-482 and read back forgivingly", () => {
  for (let i = 0; i < 50; i++) {
    const code = generateCode();
    assert.match(code, /^[A-Z]{3,6}-\d{3}$/);
    assert.equal(normalizeCode(code), code);
  }
  assert.equal(normalizeCode("oak 482"), "OAK-482");
  assert.equal(normalizeCode("0AK-48O"), "OAK-480");
  assert.equal(normalizeCode("oak482"), "OAK-482");
  assert.equal(normalizeCode("XYZ-482"), null, "Not a code word");
  assert.equal(normalizeCode("OAK-48"), null);
  assert.equal(normalizeCode(42), null);
  assert.equal(WORDS.every((word) => !/[0-9]/.test(word)), true);
});

test("routes read the same with and without Vercel's rewrite", async () => {
  const { routeOf } = await import("../lib/challenges/http.js");
  const at = (url) => ({ url });
  assert.equal(routeOf(at("/api/v1/challenges?route=abc%2Fboard"), "challenges"), "challenges/abc/board");
  assert.equal(routeOf(at("/api/v1/challenges/abc/board"), "challenges"), "challenges/abc/board");
  assert.equal(routeOf(at("/api/v1/challenges"), "challenges"), "challenges");
  assert.equal(routeOf(at("/api/v1/challenges?route="), "challenges"), "challenges");
  assert.equal(routeOf(at("/api/v1/members?route=me"), "members"), "members/me");
  assert.equal(routeOf(at("/api/v1/members/me"), "members"), "members/me");
});
