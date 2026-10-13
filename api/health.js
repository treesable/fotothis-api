import { config } from "../lib/config.js";
import { send } from "../lib/http.js";
import { isPersistent } from "../lib/store.js";

/** What's configured (never the values), to check a deploy: GET /api/health */
export default function handler(req, res) {
  send(res, 200, {
    status: "ok",
    service: "fotothis-api",
    plantnet: Boolean(process.env.PLANTNET_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
    secret: Boolean(process.env.API_SECRET),
    storage: isPersistent ? "upstash" : "memory",
    appAttest: config.appAttestMode,
    appStore: Boolean(process.env.APPSTORE_ISSUER_ID && process.env.APPSTORE_KEY_ID && process.env.APPSTORE_PRIVATE_KEY),
  });
}
