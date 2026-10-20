// Outside Challenges (docs/CHALLENGES.md "Endpoints"). vercel.json rewrites
// /api/v1/challenges/<tail> to this file with ?route=<tail>.
//
// POST   challenges                          create (or return your waiting one) → { id, code, status }
// GET    challenges/by-code/<code>           invite preview (no member needed)
// POST   challenges/<code>/join              { shareSteps? }
// POST   challenges/<id>/progress            one local day's totals
// GET    challenges/<id>/board               members only
// POST   challenges/<id>/cheer               { to, kind: "cheer" | "nudge" }
// DELETE challenges/<id>/members/<memberId>  leave (yourself) or remove (creator)
import { handle, methodNotAllowed, rateLimit, routeOf } from "../../lib/challenges/http.js";
import {
  ApiError, board, cheer, createChallenge, join, previewByCode, recordProgress, removeMember,
} from "../../lib/challenges/service.js";

export default async function handler(req, res) {
  const route = routeOf(req, "challenges");
  const parts = route.split("/").slice(1).map(decodeURIComponent);
  const is = (method, ...shape) => req.method === method && parts.length === shape.length
    && shape.every((segment, i) => segment === "*" || segment === parts[i]);

  if (is("POST")) {
    return handle(req, res, { route }, async ({ memberId }) => {
      await rateLimit(`create:${memberId}`, 10, 24 * 3600);
      return createChallenge(memberId);
    });
  }
  if (is("GET", "by-code", "*")) {
    return handle(req, res, { route, member: false }, async ({ device }) => {
      await rateLimit(`preview:${device}`, 60, 3600);  // codes can't be guessed in bulk
      return previewByCode(parts[1]);
    });
  }
  if (is("POST", "*", "join")) {
    return handle(req, res, { route }, async ({ memberId, json }) => {
      await rateLimit(`join:${memberId}`, 20, 3600);
      return join(memberId, parts[0], json);
    });
  }
  if (is("POST", "*", "progress")) {
    return handle(req, res, { route }, async ({ memberId, json }) => {
      await rateLimit(`progress:${memberId}`, 120, 3600);
      return recordProgress(memberId, parts[0], json);
    });
  }
  if (is("GET", "*", "board")) {
    return handle(req, res, { route }, async ({ memberId }) => {
      await rateLimit(`board:${memberId}`, 240, 3600);
      return board(memberId, parts[0]);
    });
  }
  if (is("POST", "*", "cheer")) return handle(req, res, { route }, ({ memberId, json }) => cheer(memberId, parts[0], json));
  if (is("DELETE", "*", "members", "*")) {
    return handle(req, res, { route }, ({ memberId }) => removeMember(memberId, parts[0], parts[2]));
  }
  const knownPath = parts.length === 0 || (parts[0] === "by-code" && parts.length === 2)
    || ["join", "progress", "board", "cheer"].includes(parts[1]) || parts[1] === "members";
  if (knownPath) return methodNotAllowed(res);
  return handle(req, res, { route, member: false }, () => { throw new ApiError(404, "not_found"); });
}
