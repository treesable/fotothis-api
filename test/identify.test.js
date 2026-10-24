import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { store } from "../lib/store.js";
import { fakeRequest, fakeResponse } from "./helpers.js";

process.env.API_SECRET = "test-secret";
process.env.PLANTNET_API_KEY = "pn";
process.env.GROQ_API_KEY = "groq";
process.env.APP_ATTEST_MODE = "off";
const { default: identify } = await import("../api/v1/identify.js");

const realFetch = globalThis.fetch;
let calls;
let plantnetScore;

beforeEach(() => {
  store._clearMemory();
  calls = { plantnet: 0, groq: 0 };
  plantnetScore = 0.8;
  globalThis.fetch = async (url) => {
    if (String(url).includes("plantnet")) {
      calls.plantnet++;
      return Response.json({ results: [{ score: plantnetScore, species: {
        scientificNameWithoutAuthor: "Hedera helix", commonNames: ["common ivy"], family: { scientificNameWithoutAuthor: "Araliaceae" },
      } }] });
    }
    if (String(url).includes("wikipedia")) {
      calls.wikipedia = (calls.wikipedia ?? 0) + 1;
      return Response.json({ query: { pages: { 1: { extract: "Hedera helix is an evergreen climbing plant. ".repeat(10) } } } });
    }
    calls.groq++;
    return Response.json({ choices: [{ message: { content: '["Ivy flowers in autumn.", "Two.", "Three."]' } }] });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function call({ secret = "test-secret", device = "device-1", body } = {}) {
  const res = fakeResponse();
  const payload = body ?? JSON.stringify({ image: Buffer.from("jpeg").toString("base64"), lat: 55.68, lng: 12.57 });
  await identify(fakeRequest({ headers: { "x-api-secret": secret, "x-device-id": device }, body: payload }), res);
  return res;
}

test("names the plant with facts", async () => {
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.species.scientificName, "Hedera helix");
  assert.equal(res.body.species.commonName, "Common Ivy");
  assert.deepEqual(res.body.facts, ["Ivy flowers in autumn.", "Two.", "Three."]);
  assert.equal(res.body.factsSource, "wikipedia");
  assert.equal(res.body.remainingToday, 2);
});

test("the species carries a rarity (null without a GBIF id)", async () => {
  const res = await call();
  assert.equal(res.body.species.rarity, null);
});

test("wrong or missing secret: 401, nothing called", async () => {
  assert.equal((await call({ secret: "nope" })).statusCode, 401);
  assert.equal(calls.plantnet, 0);
});

test("4th ID of the day on a trial: 429 queued, Pl@ntNet not called", async () => {
  for (let i = 0; i < 3; i++) assert.equal((await call()).statusCode, 200);
  const res = await call();
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body.queued, true);
  assert.ok(Number(res.headers["retry-after"]) > 0);
  assert.equal(calls.plantnet, 3);
});

test("facts are cached per species: one Groq call", async () => {
  await call();
  await call({ device: "device-2" });
  assert.equal(calls.groq, 1);
});

test("unsure match: no name, and it doesn't use up an ID", async () => {
  plantnetScore = 0.1;
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.species, null);
  assert.equal(res.body.remainingToday, 3);
  assert.equal(calls.groq, 0);
});

test("bad requests", async () => {
  assert.equal((await call({ body: "not json" })).statusCode, 400);
  assert.equal((await call({ body: JSON.stringify({}) })).statusCode, 400);
  assert.equal((await call({ device: "" })).statusCode, 400);
});
