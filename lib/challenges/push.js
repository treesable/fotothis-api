// Apple Push Notification service, token-based (.p8 key in APNS_KEY_ID / APNS_TEAM_ID /
// APNS_PRIVATE_KEY). Policy from docs/CHALLENGES.md: at most 3 pushes a day per person and none
// 21:30–08:00 in their own time zone. A push is a nice-to-have: failures are logged, never thrown.
import { createPrivateKey, sign } from "node:crypto";
import http2 from "node:http2";
import { config } from "../config.js";
import { store } from "../store.js";

export const POLICY = { maxPerDay: 3, quietStart: "21:30", quietEnd: "08:00" };

export function isConfigured() {
  return Boolean(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_PRIVATE_KEY);
}

// MARK: - Policy

/** "HH:MM" in the member's time zone. */
export function localTime(now, timeZone) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

export function isQuietHours(now, timeZone) {
  const time = localTime(now, timeZone);
  return time >= POLICY.quietStart || time < POLICY.quietEnd;
}

/** Counts this push against the member's daily allowance; false when it's used up. */
export async function takeAllowance(memberId, localDate) {
  const count = await store.incr(`push:${memberId}:${localDate}`, 2 * 24 * 3600);
  return count <= POLICY.maxPerDay;
}

// MARK: - Wording

export function messageFor(kind, data = {}) {
  const name = data.nickname ?? "Someone";
  switch (kind) {
    case "joined": return { title: "Outside Challenge", body: `${name} joined your challenge` };
    case "outside": return { title: "Outside Challenge", body: `${name} just went outside` };
    case "cheer": return { title: "Outside Challenge", body: `${name} cheered you on` };
    case "nudge": return { title: "Outside Challenge", body: "Your crew is outside. Join them!" };
    case "day6": return { title: "Day 6 of 7", body: data.behind > 0
      ? `You're ${data.behind} ${data.behind === 1 ? "point" : "points"} behind ${data.leader}`
      : "You're in the lead. One more day!" };
    case "complete": return { title: "Challenge complete!", body: "See who won" };
    default: return null;
  }
}

// MARK: - APNs

let cachedToken = null;

/** The provider token (ES256 JWT), reused for 50 minutes as Apple asks. */
export function providerToken(now = Date.now()) {
  if (cachedToken && now - cachedToken.issuedAt < 50 * 60 * 1000) return cachedToken.value;
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: process.env.APNS_KEY_ID })).toString("base64url");
  const issuedAt = Math.floor(now / 1000);
  const claims = Buffer.from(JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: issuedAt })).toString("base64url");
  const key = createPrivateKey(process.env.APNS_PRIVATE_KEY.replace(/\\n/g, "\n"));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  cachedToken = { value: `${header}.${claims}.${signature}`, issuedAt: now };
  return cachedToken.value;
}

/** Replaced in tests. Returns { status, reason }. */
export const transport = {
  async send({ sandbox, deviceToken, headers, payload }) {
    const host = sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
    const session = http2.connect(host);
    try {
      return await new Promise((resolve, reject) => {
        const request = session.request({ ":method": "POST", ":path": `/3/device/${deviceToken}`, ...headers });
        let status = 0;
        let text = "";
        request.setTimeout(10_000, () => request.close(http2.constants.NGHTTP2_CANCEL));
        request.on("response", (h) => { status = h[":status"]; });
        request.on("data", (chunk) => { text += chunk; });
        request.on("end", () => resolve({ status, reason: text ? JSON.parse(text).reason : null }));
        request.on("error", reject);
        request.end(JSON.stringify(payload));
      });
    } finally {
      session.close();
    }
  },
};

/**
 * Sends one push to one member. `member`: { id, apns_token, apns_sandbox, time_zone }.
 * Returns "sent", "skipped:<why>" or "failed:<why>"; `onBadToken` clears a dead token.
 */
export async function pushTo(member, { kind, challengeId, data }, { now = new Date(), localDate, onBadToken } = {}) {
  if (!isConfigured()) return "skipped:not_configured";
  if (!member.apns_token) return "skipped:no_token";
  if (isQuietHours(now, member.time_zone)) return "skipped:quiet_hours";
  const message = messageFor(kind, data);
  if (!message) return "skipped:unknown_kind";
  if (!(await takeAllowance(member.id, localDate))) return "skipped:daily_limit";
  try {
    const result = await transport.send({
      sandbox: member.apns_sandbox,
      deviceToken: member.apns_token,
      headers: {
        authorization: `bearer ${providerToken(now.getTime())}`,
        "apns-topic": config.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-collapse-id": `${challengeId}:${kind}`.slice(0, 64),
      },
      payload: {
        aps: { alert: message, sound: "default", "thread-id": challengeId },
        challengeId,
        kind,
      },
    });
    if (result.status === 200) return "sent";
    if (result.status === 410 || result.reason === "BadDeviceToken" || result.reason === "Unregistered") {
      await onBadToken?.();
      return `failed:${result.reason ?? "gone"}`;
    }
    console.warn(`push ${kind}: ${result.status} ${result.reason}`);
    return `failed:${result.reason ?? result.status}`;
  } catch (error) {
    console.warn(`push ${kind}:`, error.message);
    return "failed:network";
  }
}

export function _resetTokenCache() {
  cachedToken = null;
}
