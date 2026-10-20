// Anonymous challenge members (docs/CHALLENGES.md "Identity"). A member is a random id plus a
// secret the phone keeps in its Keychain. The server never stores secrets: each one is
// HMAC(MEMBER_KEY, memberId), so a database leak exposes nothing that signs requests.
//
// Every member request carries:
//   x-member-id         the member id
//   x-member-timestamp  unix seconds (must be within 5 minutes of the server clock)
//   x-member-signature  base64url HMAC-SHA256(secret, "METHOD\nroute\ntimestamp\nsha256hex(body)")
// where `route` is the path after /api/v1/, e.g. "challenges/<id>/progress".
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { header } from "../http.js";

export const SIGNATURE_WINDOW_SECONDS = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function memberKey() {
  const key = process.env.MEMBER_KEY;
  if (!key || key.length < 32) throw Object.assign(new Error("MEMBER_KEY is not set"), { status: 503 });
  return key;
}

export function secretFor(memberId) {
  return createHmac("sha256", memberKey()).update(`member:${memberId}`).digest("base64url");
}

export function canonical(method, route, timestamp, body) {
  const bodyHash = createHash("sha256").update(body ?? Buffer.alloc(0)).digest("hex");
  return `${method.toUpperCase()}\n${route}\n${timestamp}\n${bodyHash}`;
}

export function sign(secret, method, route, timestamp, body) {
  return createHmac("sha256", secret).update(canonical(method, route, timestamp, body)).digest("base64url");
}

/** The member id when the signature checks out, else null. */
export function verifyMember(req, route, body, now = Date.now()) {
  const memberId = header(req, "x-member-id");
  const timestamp = header(req, "x-member-timestamp");
  const signature = header(req, "x-member-signature");
  if (!memberId || !UUID.test(memberId) || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return null;
  if (Math.abs(now / 1000 - Number(timestamp)) > SIGNATURE_WINDOW_SECONDS) return null;
  const expected = Buffer.from(sign(secretFor(memberId), req.method, route, timestamp, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? memberId.toLowerCase() : null;
}
