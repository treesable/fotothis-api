import { AttestError, verifyAttestation } from "../../lib/appattest.js";
import { hasValidSecret, readBody, send } from "../../lib/http.js";

/** POST /api/v1/attest { keyId, attestation, challenge } (base64): registers the app's key once. */
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!hasValidSecret(req)) return send(res, 401, { error: "Unauthorized" });
  try {
    const { keyId, attestation, challenge } = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8"));
    if (!keyId || !attestation || !challenge) return send(res, 400, { error: "keyId, attestation and challenge are required" });
    const { environment } = await verifyAttestation({ keyId, attestation, challenge });
    console.log(`attest: ok (${environment})`);
    send(res, 200, { ok: true, environment });
  } catch (error) {
    if (error instanceof AttestError || error instanceof SyntaxError) {
      console.warn("attest refused:", error.message);
      return send(res, 400, { error: "Attestation refused" });
    }
    console.error("attest:", error);
    send(res, 503, { error: "Try again later" });
  }
}
