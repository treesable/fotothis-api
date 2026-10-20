// POST  /api/v1/members     → new anonymous member { nickname, colour, apnsToken?, apnsSandbox?, shareSteps?, timeZone? }
//                              returns { memberId, secret } (the phone keeps both in its Keychain)
// GET   /api/v1/members/me  → your profile + current challenge
// PATCH /api/v1/members/me  → nickname, colour, apnsToken, apnsSandbox, shareSteps, timeZone
// (vercel.json rewrites /members/me to ?route=me.)
import { handle, methodNotAllowed, rateLimit, routeOf } from "../../lib/challenges/http.js";
import { ApiError, createMember, me, updateMember } from "../../lib/challenges/service.js";

export default async function handler(req, res) {
  const route = routeOf(req, "members");
  if (route === "members") {
    if (req.method !== "POST") return methodNotAllowed(res);
    return handle(req, res, { route, member: false }, async ({ device, json }) => {
      await rateLimit(`members:${device}`, 10, 24 * 3600);
      return createMember(json);
    });
  }
  if (route === "members/me") {
    if (req.method === "GET") return handle(req, res, { route }, ({ memberId }) => me(memberId));
    if (req.method === "PATCH") {
      return handle(req, res, { route }, async ({ memberId, json }) => {
        await updateMember(memberId, json);
        return me(memberId);
      });
    }
    return methodNotAllowed(res);
  }
  return handle(req, res, { route, member: false }, () => { throw new ApiError(404, "not_found"); });
}
