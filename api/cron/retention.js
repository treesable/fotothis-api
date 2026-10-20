// GET /api/cron/retention: Vercel Cron, once a day (vercel.json). Vercel sends
// "Authorization: Bearer $CRON_SECRET"; without CRON_SECRET set, it refuses everything.
import { timingSafeEqual } from "node:crypto";
import { runRetention } from "../../lib/challenges/retention.js";
import { send } from "../../lib/http.js";

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  const given = req.headers.authorization ?? "";
  const ok = expected && given.length === `Bearer ${expected}`.length
    && timingSafeEqual(Buffer.from(given), Buffer.from(`Bearer ${expected}`));
  if (!ok) return send(res, 401, { error: "Unauthorized" });
  try {
    const result = await runRetention();
    console.log("retention:", result);
    return send(res, 200, result);
  } catch (error) {
    console.error("retention:", error);
    return send(res, error.status ?? 500, { error: "Retention failed" });
  }
}
