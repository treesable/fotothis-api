// The request pipeline for challenge endpoints: app secret → body → App Attest → member
// signature → rate limit → service call. Errors come back as { error: code, message }.
import { checkAppAttest } from "../attest-gate.js";
import { hasValidSecret, readBody, send } from "../http.js";
import { store } from "../store.js";
import { verifyMember } from "./auth.js";
import { ApiError } from "./service.js";

const MAX_BODY = 16 * 1024;

/**
 * The route after /api/v1/ ("challenges/<id>/board"). Vercel rewrites pass the tail as
 * ?route=…; a direct call has it in the path.
 */
export function routeOf(req, base) {
  const url = new URL(req.url ?? "/", "http://local");
  const tail = url.searchParams.get("route");
  if (tail !== null) return tail ? `${base}/${tail}` : base;
  const match = url.pathname.match(/^\/api\/v1\/(.+?)\/?$/);
  return match ? match[1] : base;
}

/** Fixed-window limit on top of the shared store (Upstash in production). */
export async function rateLimit(key, max, windowSeconds) {
  const count = await store.incr(`rl:${key}`, windowSeconds);
  if (count > max) throw new ApiError(429, "rate_limited", "Too many requests, try again later");
}

/**
 * Runs `work({ memberId, device, json, route })`. `member: true` requires a signed member.
 */
export async function handle(req, res, { route, member = true }, work) {
  try {
    if (!hasValidSecret(req)) throw new ApiError(401, "unauthorized");
    let body;
    try {
      body = await readBody(req, MAX_BODY);
    } catch (error) {
      throw new ApiError(error.status ?? 400, error.status === 413 ? "too_large" : "bad_request");
    }
    const gate = await checkAppAttest(req, body);
    if (!gate.ok) throw new ApiError(401, "unauthorized");
    let memberId = null;
    if (member) {
      memberId = verifyMember(req, route, body);
      if (!memberId) throw new ApiError(401, "bad_signature");
    }
    let json = {};
    if (body.length) {
      try {
        json = JSON.parse(body.toString("utf8"));
      } catch {
        throw new ApiError(400, "bad_json");
      }
    }
    const result = await work({ memberId, device: gate.device ?? memberId ?? "anonymous", json, route });
    return send(res, 200, result ?? {});
  } catch (error) {
    if (error instanceof ApiError) return send(res, error.status, { error: error.code, message: error.message });
    if (error.status === 503) return send(res, 503, { error: "unavailable", message: "Challenges aren't set up yet" });
    console.error(`challenges ${req.method} ${route}:`, error);
    return send(res, 500, { error: "server_error" });
  }
}

export function methodNotAllowed(res) {
  return send(res, 405, { error: "method_not_allowed" });
}
