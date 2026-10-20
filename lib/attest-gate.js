// The app-secret + App Attest gate shared by every app endpoint (species ID, challenges).
// APP_ATTEST_MODE: "enforce" refuses requests without a valid assertion over the exact body;
// "log" lets them through with a warning; "off" skips the check.
import { AttestError, verifyAssertion } from "./appattest.js";
import { config } from "./config.js";
import { header } from "./http.js";

/** `{ ok: true, device }` (the attested key, else the app's install id) or `{ ok: false }`. */
export async function checkAppAttest(req, body) {
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
      if (config.appAttestMode === "enforce") return { ok: false };
      console.warn(`App Attest (log mode): ${error.message}`);
    }
  }
  return { ok: true, device };
}
