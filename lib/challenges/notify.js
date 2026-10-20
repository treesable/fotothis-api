// Challenge moments → push (lib/challenges/push.js decides quiet hours and the daily limit).
// Tests read `sent` to see what would go out, and `results` for what push did with it.
import { query } from "../db.js";
import { pushTo } from "./push.js";

export const sent = [];
export const results = [];

function localDateIn(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** `{ kind, challengeId, to: memberId[], from?: memberId, data? }`. Never throws. */
export async function notify(message, now = new Date()) {
  sent.push(message);
  if (!message.to?.length) return;
  try {
    const { rows } = await query(
      "select id, apns_token, apns_sandbox, time_zone from members where id = any($1::uuid[])", [message.to]);
    for (const member of rows) {
      const result = await pushTo(member, message, {
        now,
        localDate: localDateIn(now, member.time_zone),
        onBadToken: () => query("update members set apns_token = null where id = $1", [member.id]),
      });
      results.push({ to: member.id, kind: message.kind, result });
    }
  } catch (error) {
    console.warn(`notify ${message.kind}:`, error.message);
  }
}

export function _resetSent() {
  sent.length = 0;
  results.length = 0;
}
