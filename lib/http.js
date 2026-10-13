import { timingSafeEqual } from "node:crypto";

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/** The raw body (App Attest assertions sign these exact bytes). */
export async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Body too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** x-api-secret must match API_SECRET. Refuses everything if the server has no secret set. */
export function hasValidSecret(req) {
  const expected = process.env.API_SECRET;
  const given = req.headers["x-api-secret"];
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function header(req, name) {
  const value = req.headers[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}
