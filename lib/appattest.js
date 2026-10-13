// Apple App Attest: proves a request comes from the real FotoThis app on a real iPhone.
// 1. The app gets a one-time challenge, makes a key in the Secure Enclave and asks Apple to
//    attest it; we check Apple's certificate chain and store the key's public part.
// 2. Every identify request carries an assertion: the key's signature over the request body.
// https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server
import { createHash, createVerify, randomBytes, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { decodeCbor } from "./cbor.js";
import { config } from "./config.js";
import { store } from "./store.js";

const ROOT = new X509Certificate(readFileSync(new URL("./apple-app-attest-root.pem", import.meta.url)));
const NONCE_OID = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]);
const AAGUID_PRODUCTION = Buffer.concat([Buffer.from("appattest"), Buffer.alloc(7)]);
const AAGUID_DEVELOPMENT = Buffer.from("appattestdevelop");

const sha256 = (...parts) => createHash("sha256").update(Buffer.concat(parts)).digest();
const appIdHash = () => sha256(Buffer.from(`${config.teamId}.${config.bundleId}`));

export class AttestError extends Error {}

// MARK: Challenge

export async function newChallenge() {
  const challenge = randomBytes(32).toString("base64url");
  await store.set(`attest:challenge:${challenge}`, "1", config.challengeSeconds);
  return challenge;
}

// MARK: Attestation (once per install)

/** authenticatorData layout: rpIdHash 32 | flags 1 | counter 4 | aaguid 16 | credIdLen 2 | credId. */
export function parseAuthData(authData) {
  if (authData.length < 37) throw new AttestError("authData too short");
  const parsed = {
    rpIdHash: authData.subarray(0, 32),
    counter: authData.readUInt32BE(33),
  };
  if (authData.length >= 55) {
    parsed.aaguid = authData.subarray(37, 53);
    const idLength = authData.readUInt16BE(53);
    parsed.credentialId = authData.subarray(55, 55 + idLength);
  }
  return parsed;
}

/** The 32-byte nonce in the leaf certificate's Apple extension (1.2.840.113635.100.8.2). */
export function nonceFromCertificate(der) {
  let index = der.indexOf(NONCE_OID);
  if (index < 0) throw new AttestError("No nonce extension");
  index += NONCE_OID.length;
  if (der[index] === 0x01) index += 3; // optional "critical" BOOLEAN
  if (der[index] !== 0x04) throw new AttestError("Bad nonce extension");
  const length = der[index + 1];
  const value = der.subarray(index + 2, index + 2 + length);
  return value.subarray(value.length - 32);
}

function uncompressedPoint(publicKey) {
  const jwk = publicKey.export({ format: "jwk" });
  return Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
}

/**
 * Checks an attestation for `keyId` (base64) made over `challenge`, and stores the public key.
 * The app passes SHA256(challenge as UTF-8) as clientDataHash to attestKey.
 */
export async function verifyAttestation({ keyId, attestation, challenge }, { now = new Date(), root = ROOT } = {}) {
  if (!(await store.take(`attest:challenge:${challenge}`))) throw new AttestError("Unknown or used challenge");

  const object = decodeCbor(Buffer.from(attestation, "base64"));
  if (object.fmt !== "apple-appattest") throw new AttestError("Not an App Attest object");
  const [leafDer, intermediateDer] = object.attStmt?.x5c ?? [];
  if (!leafDer || !intermediateDer) throw new AttestError("Missing certificates");
  const leaf = new X509Certificate(leafDer);
  const intermediate = new X509Certificate(intermediateDer);

  // 1. Apple's chain: leaf ← intermediate ← App Attestation Root CA, all valid now.
  if (!leaf.verify(intermediate.publicKey) || !intermediate.verify(root.publicKey)) {
    throw new AttestError("Certificate chain doesn't lead to Apple");
  }
  for (const cert of [leaf, intermediate]) {
    if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) throw new AttestError("Certificate expired");
  }

  // 2–4. The nonce in the certificate covers this authData and this challenge.
  const authData = object.authData;
  const clientDataHash = sha256(Buffer.from(challenge, "utf8"));
  if (!nonceFromCertificate(Buffer.from(leaf.raw)).equals(sha256(authData, clientDataHash))) {
    throw new AttestError("Nonce mismatch");
  }

  // 5. The key id is the hash of the certified public key.
  const keyIdBytes = Buffer.from(keyId, "base64");
  if (!sha256(uncompressedPoint(leaf.publicKey)).equals(keyIdBytes)) throw new AttestError("Key id mismatch");

  // 6–9. Our app, a fresh key, Apple's App Attest environment, same key id.
  const parsed = parseAuthData(authData);
  if (!parsed.rpIdHash.equals(appIdHash())) throw new AttestError("Different app");
  if (parsed.counter !== 0) throw new AttestError("Counter must start at 0");
  const environment = parsed.aaguid?.equals(AAGUID_PRODUCTION) ? "production"
    : parsed.aaguid?.equals(AAGUID_DEVELOPMENT) ? "development" : null;
  if (!environment) throw new AttestError("Unknown App Attest environment");
  if (!parsed.credentialId?.equals(keyIdBytes)) throw new AttestError("Credential id mismatch");

  await store.set(`attest:key:${keyId}`, JSON.stringify({
    publicKey: leaf.publicKey.export({ type: "spki", format: "pem" }),
    counter: 0,
    environment,
  }));
  return { environment };
}

// MARK: Assertion (every request)

/** Checks the assertion over `body` (the exact request bytes) and moves the counter on. */
export async function verifyAssertion({ keyId, assertion, body }) {
  const saved = await store.get(`attest:key:${keyId}`);
  if (!saved) throw new AttestError("Unknown key: attest first");
  const key = JSON.parse(saved);

  const { signature, authenticatorData } = decodeCbor(Buffer.from(assertion, "base64"));
  if (!signature || !authenticatorData) throw new AttestError("Malformed assertion");

  const nonce = sha256(authenticatorData, sha256(body));
  const valid = createVerify("SHA256").update(nonce).verify(key.publicKey, signature);
  if (!valid) throw new AttestError("Bad signature");

  const parsed = parseAuthData(authenticatorData);
  if (!parsed.rpIdHash.equals(appIdHash())) throw new AttestError("Different app");
  if (parsed.counter <= key.counter) throw new AttestError("Replayed assertion");

  key.counter = parsed.counter;
  await store.set(`attest:key:${keyId}`, JSON.stringify(key));
  return { environment: key.environment };
}
