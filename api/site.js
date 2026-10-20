// The public bits of fotothis-api (vercel.json rewrites):
//   /.well-known/apple-app-site-association → universal links for /c/*
//   /icon.png                                → the app icon (invite page, link previews)
//   /c/<code>                                → the friend's invite page
import { readFileSync } from "node:fs";
import { normalizeCode } from "../lib/challenges/codes.js";
import { rateLimit } from "../lib/challenges/http.js";
import { appSiteAssociation, invitePage } from "../lib/challenges/invite-page.js";
import { ApiError, previewByCode } from "../lib/challenges/service.js";

const ICON = readFileSync(new URL("../assets/icon-512.png", import.meta.url));

export default async function handler(req, res) {
  const url = new URL(req.url ?? "/", "http://local");
  const page = url.searchParams.get("page");

  if (page === "aasa") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.end(JSON.stringify(appSiteAssociation()));
  }
  if (page === "icon") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.end(ICON);
  }
  if (page === "invite") {
    const raw = url.searchParams.get("code") ?? "";
    const code = normalizeCode(raw) ?? raw.slice(0, 16);
    let preview = null;
    let status = 200;
    try {
      const ip = String(req.headers["x-forwarded-for"] ?? "local").split(",")[0].trim();
      await rateLimit(`invite:${ip}`, 120, 3600);
      preview = await previewByCode(code);
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) status = 429;
      else if (error instanceof ApiError) status = 404;
      else console.error("invite page:", error);
    }
    res.statusCode = status;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.end(invitePage(code, preview));
  }
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain");
  return res.end("Not found");
}
