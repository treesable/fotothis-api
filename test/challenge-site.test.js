import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { createChallenge, createMember, join } from "../lib/challenges/service.js";
import { appSiteAssociation, escapeHtml, invitePage } from "../lib/challenges/invite-page.js";
import { store } from "../lib/store.js";
import { _closeForTests, freshDatabase, skipWithoutDatabase } from "./db-helpers.js";
import { fakeRequest } from "./helpers.js";

const { default: site } = await import("../api/site.js");

beforeEach(async () => {
  process.env.MEMBER_KEY = "k".repeat(64);
  store._clearMemory();
  if (!skipWithoutDatabase) await freshDatabase();
});
after(async () => { if (!skipWithoutDatabase) await _closeForTests(); });

async function get(url) {
  const req = fakeRequest({ method: "GET" });
  req.url = url;
  const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(body) { this.body = body; } };
  await site(req, res);
  return res;
}

test("universal links: /c/* opens the app", async () => {
  assert.deepEqual(appSiteAssociation(), { applinks: { details: [{
    appIDs: ["J72XXRT45L.com.treesable.fotothis"], components: [{ "/": "/c/*", comment: "Outside Challenge invites" }],
  }] } });
  const res = await get("/api/site?page=aasa");
  assert.equal(res.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(res.body), appSiteAssociation());
});

test("the icon is served", async () => {
  const res = await get("/api/site?page=icon");
  assert.equal(res.headers["content-type"], "image/png");
  assert.equal(res.body.subarray(1, 4).toString(), "PNG");
});

test("home, privacy and terms pages are served, and vercel.json routes them", async () => {
  for (const [page, text] of [["home", "Snap nature"], ["privacy", "Pl@ntNet"], ["terms", "Standard End User License Agreement"]]) {
    const res = await get(`/api/site?page=${page}`);
    assert.equal(res.statusCode, 200, page);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.ok(res.body.includes(text), page);
  }
  const { rewrites } = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  for (const [source, page] of [["/", "home"], ["/privacy", "privacy"], ["/terms", "terms"]]) {
    assert.equal(rewrites.find((r) => r.source === source)?.destination, `/api/site?page=${page}`);
  }
});

test("nicknames can't inject HTML", () => {
  assert.equal(escapeHtml(`<script>alert("x")</script>&'`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;");
  const html = invitePage("OAK-482", {
    code: "OAK-482", status: "waiting", spotsLeft: 7,
    inviter: { nickname: "<img src=x onerror=alert(1)>", colour: "red;background:url(x)" },
    members: [{ nickname: "<b>Bo</b>", colour: "#8FD19E" }],
  });
  assert.equal(html.includes("<img src=x"), false);
  assert.equal(html.includes("<b>Bo</b>"), false);
  assert.equal(html.includes("url(x)"), false, "Colours are checked too");
});

test("the invite page shows the inviter, the crew and the code", { skip: skipWithoutDatabase }, async () => {
  const marcel = await createMember({ nickname: "Marcel", colour: "#FF7A5C" });
  const { code } = await createChallenge(marcel.memberId);
  const sofie = await createMember({ nickname: "Sofie", colour: "#8FD19E" });
  await join(sofie.memberId, code);
  const res = await get(`/api/site?page=invite&code=${code.toLowerCase()}`);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Marcel invited you to a 7.day Outside Challenge/);
  assert.match(res.body, /Sofie/);
  assert.match(res.body, /You\?/);
  assert.match(res.body, new RegExp(`Your invite code: <b>${code}</b>`));
  assert.match(res.body, new RegExp(`href="fotothis://c/${code}"`), "Opens the installed app when the universal link doesn't");
  assert.match(res.body, /og:title/);
  assert.equal(/points|pts|steps/i.test(res.body.replace(/<style>[\s\S]*?<\/style>/, "")), false, "No stats on the page");
});

test("unknown codes get a friendly 404 page", { skip: skipWithoutDatabase }, async () => {
  const res = await get("/api/site?page=invite&code=OAK-000");
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /This invite wasn't found/);
});
