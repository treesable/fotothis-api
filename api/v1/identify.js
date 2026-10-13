// POST /api/v1/identify: names the plant in a photo the app has already verified (the unlock
// never waits for this). Body JSON { image: base64 JPEG, lat?, lng?, lang? }.
// Headers: x-api-secret, x-device-id, x-app-attest-key-id + x-app-attest-assertion (over the
// exact body bytes), x-transaction-id (App Store, once subscriptions exist).
// Answers: 200 { species | null, facts, factsSource ("wikipedia" | "model"), remainingToday }, 429 { queued: true } over the trial cap.
import { AttestError, verifyAssertion } from "../../lib/appattest.js";
import { tierFor } from "../../lib/appstore.js";
import { refundId, secondsUntilReset, takeId } from "../../lib/cap.js";
import { config } from "../../lib/config.js";
import { factsFor } from "../../lib/facts.js";
import { hasValidSecret, header, readBody, send } from "../../lib/http.js";
import { identify } from "../../lib/plantnet.js";

const LANGS = new Set(["en", "da", "de", "fr", "es", "nl"]);

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!hasValidSecret(req)) return send(res, 401, { error: "Unauthorized" });

  let body;
  let request;
  try {
    body = await readBody(req, Math.ceil(config.maxImageBytes * 1.4) + 4096);
    request = JSON.parse(body.toString("utf8"));
  } catch (error) {
    return send(res, error.status ?? 400, { error: error.status === 413 ? "Photo too large" : "Bad request" });
  }
  const image = typeof request.image === "string" ? Buffer.from(request.image, "base64") : null;
  if (!image?.length || image.length > config.maxImageBytes) return send(res, 400, { error: "A JPEG photo is required" });

  // Who is asking: the attested key when it checks out, else the app's install id.
  const keyId = header(req, "x-app-attest-key-id");
  const assertion = header(req, "x-app-attest-assertion");
  let device = header(req, "x-device-id");
  if (config.appAttestMode !== "off") {
    try {
      if (!keyId || !assertion) throw new AttestError("No assertion");
      await verifyAssertion({ keyId, assertion, body });
      device = `key:${keyId}`;
    } catch (error) {
      if (!(error instanceof AttestError)) console.error("assertion check:", error);
      if (config.appAttestMode === "enforce") return send(res, 401, { error: "Unauthorized" });
      console.warn(`App Attest (log mode): ${error.message}`);
    }
  }
  if (!device || device.length > 200) return send(res, 400, { error: "x-device-id is required" });

  const tier = await tierFor(header(req, "x-transaction-id"));
  const allowance = await takeId(device, tier);
  if (!allowance.allowed) {
    res.setHeader("Retry-After", String(secondsUntilReset()));
    return send(res, 429, { queued: true, retryAfterSeconds: secondsUntilReset() });
  }

  const lang = LANGS.has(request.lang) ? request.lang : "en";
  try {
    const species = await identify(image, { lat: request.lat, lng: request.lng, lang });
    if (!species || species.score < config.minSpeciesScore) {
      await refundId(device, tier);
      return send(res, 200, { species: null, facts: [], remainingToday: allowance.remaining === null ? null : allowance.remaining + 1 });
    }
    const { facts, source } = await factsFor(species, lang);
    console.log(`identify: ${species.scientificName} ${species.score} (${tier}), facts from ${source}`);
    return send(res, 200, { species, facts, factsSource: source, remainingToday: allowance.remaining });
  } catch (error) {
    await refundId(device, tier);
    console.error("identify:", error);
    return send(res, error.status ?? 502, { error: "Species ID is unavailable, try again later" });
  }
}
