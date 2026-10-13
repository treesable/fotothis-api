// Trial or paid, asked from Apple with the App Store Server API (never trusted from the app).
// Without the API key (subscriptions arrive in week 4) or a transaction id, everyone is "trial".
import { createPrivateKey, sign } from "node:crypto";
import { config } from "./config.js";
import { store } from "./store.js";

const PRODUCTION = "https://api.storekit.itunes.apple.com";
const SANDBOX = "https://api.storekit-sandbox.itunes.apple.com";

const isConfigured = () =>
  Boolean(process.env.APPSTORE_ISSUER_ID && process.env.APPSTORE_KEY_ID && process.env.APPSTORE_PRIVATE_KEY);

function token(now = Math.floor(Date.now() / 1000)) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "ES256", kid: process.env.APPSTORE_KEY_ID, typ: "JWT" });
  const payload = encode({
    iss: process.env.APPSTORE_ISSUER_ID, iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1", bid: config.bundleId,
  });
  const key = createPrivateKey(process.env.APPSTORE_PRIVATE_KEY.replace(/\\n/g, "\n"));
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${signature.toString("base64url")}`;
}

/** The payload of a JWS from Apple. It came straight from Apple over TLS with our own token. */
export function decodeJws(jws) {
  return JSON.parse(Buffer.from(jws.split(".")[1], "base64url").toString("utf8"));
}

/**
 * "paid" or "trial" from a subscription status response.
 * Status 1 = active, 4 = billing grace period. A free-trial transaction is "trial".
 */
export function tierFromStatus(response) {
  const latest = (response?.data ?? []).flatMap((group) => group.lastTransactions ?? []);
  for (const item of latest) {
    if (item.status !== 1 && item.status !== 4) continue;
    const transaction = decodeJws(item.signedTransactionInfo);
    const isFreeTrial = transaction.offerDiscountType === "FREE_TRIAL" || (transaction.offerType === 1 && transaction.price === 0);
    if (!isFreeTrial) return "paid";
  }
  return "trial";
}

export async function tierFor(transactionId) {
  if (!transactionId || !/^\d{1,30}$/.test(transactionId) || !isConfigured()) return "trial";
  const cacheKey = `tier:${transactionId}`;
  const cached = await store.get(cacheKey).catch(() => null);
  if (cached) return cached;

  let tier = "trial";
  try {
    const headers = { Authorization: `Bearer ${token()}` };
    let response = await fetch(`${PRODUCTION}/inApps/v1/subscriptions/${transactionId}`, { headers });
    if (response.status === 404) response = await fetch(`${SANDBOX}/inApps/v1/subscriptions/${transactionId}`, { headers });
    if (response.ok) tier = tierFromStatus(await response.json());
    else console.warn("App Store Server API:", response.status);
  } catch (error) {
    console.error("App Store check failed:", error.message);
    return "trial"; // don't cache a failure
  }
  await store.set(cacheKey, tier, config.tierCacheSeconds).catch(() => {});
  return tier;
}
