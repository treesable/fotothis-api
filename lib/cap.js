// Species IDs per device per day: trial 3, paid unlimited. Days are UTC, so they reset at
// 01:00/02:00 in Denmark; the app retries a "Mystery find" the next day either way.
import { config } from "./config.js";
import { store } from "./store.js";

export function dayKey(device, now = new Date()) {
  return `cap:${device}:${now.toISOString().slice(0, 10)}`;
}

/** Takes one ID from today's allowance. `{ allowed, remaining }` (remaining null = unlimited). */
export async function takeId(device, tier, now = new Date()) {
  if (tier === "paid") return { allowed: true, remaining: null };
  const key = dayKey(device, now);
  const used = await store.incr(key, 2 * 24 * 3600);
  if (used > config.trialDailyIds) {
    await store.incr(key, 0, -1);
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: config.trialDailyIds - used };
}

/** Gives the ID back when nothing was identified (a failed lookup shouldn't cost one). */
export async function refundId(device, tier, now = new Date()) {
  if (tier === "paid") return;
  await store.incr(dayKey(device, now), 0, -1);
}

/** Seconds until the next UTC midnight (Retry-After on a 429). */
export function secondsUntilReset(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((next - now.getTime()) / 1000);
}
