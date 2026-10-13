import { newChallenge } from "../../lib/appattest.js";
import { hasValidSecret, send } from "../../lib/http.js";

/** POST /api/v1/challenge → { challenge }: one-time, 5 minutes, for App Attest. */
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!hasValidSecret(req)) return send(res, 401, { error: "Unauthorized" });
  try {
    send(res, 200, { challenge: await newChallenge() });
  } catch (error) {
    console.error("challenge:", error);
    send(res, 503, { error: "Try again later" });
  }
}
