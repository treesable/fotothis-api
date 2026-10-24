import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { cellFor, classify, rarityFor, seasonality } from "../lib/rarity.js";
import { store } from "../lib/store.js";

// Real GBIF counts, Copenhagen square (55–56 °N, 12–13 °E), 24 Oct 2026.
const baseline = { count: 1_477_941, months: [9640, 6654, 14786, 51499, 160821, 258532, 281437, 293077, 216425, 119270, 38240, 11824] };
const daisy = { count: 4722, months: [49, 30, 172, 554, 903, 870, 592, 618, 497, 252, 118, 56] };
const ivy = { count: 1543, months: [48, 49, 109, 153, 168, 164, 190, 263, 166, 105, 47, 75] };
const snowdrop = { count: 856, months: [31, 183, 356, 217, 57, 5, 1, 1, 1, 0, 0, 0] };
const woodAnemone = { count: 2714, months: [1, 1, 231, 994, 658, 382, 197, 58, 99, 60, 22, 7] };
const beeOrchid = { count: 229, months: [5, 5, 9, 2, 6, 174, 15, 2, 4, 4, 0, 3] };
const autumnCrocus = { count: 53, months: [0, 0, 3, 9, 5, 0, 0, 1, 30, 5, 0, 0] };
const dandelion = { count: 153, months: [1, 0, 6, 27, 40, 25, 11, 13, 20, 7, 1, 2] };
const hydrangea = { count: 5, months: [0, 0, 0, 0, 0, 1, 2, 1, 1, 0, 0, 0] };

test("year-round plants are common, plants that cluster in some months are seasonal", () => {
  assert.equal(classify({ species: daisy, genusCount: 4900, baseline }), "common");
  assert.equal(classify({ species: ivy, genusCount: 1600, baseline }), "common");
  assert.equal(classify({ species: snowdrop, genusCount: 900, baseline }), "seasonal");
  assert.equal(classify({ species: woodAnemone, genusCount: 3000, baseline }), "seasonal");
});

test("few local records of the species and its genus: rare", () => {
  assert.equal(classify({ species: beeOrchid, genusCount: 230, baseline }), "rare");
  assert.equal(classify({ species: autumnCrocus, genusCount: 105, baseline }), "rare");
});

test("a narrowly named species in a genus that's everywhere is not rare (dandelions)", () => {
  assert.notEqual(classify({ species: dandelion, genusCount: 3385, baseline }), "rare");
});

test("too few records to say, or too little data in the square: no tier", () => {
  assert.equal(classify({ species: hydrangea, genusCount: 12, baseline }), null, "Garden plant, or a wrong name");
  assert.equal(classify({ species: daisy, genusCount: 4900, baseline: { count: 5000, months: baseline.months } }), null);
});

test("seasonality corrects for people going out more in summer", () => {
  assert.equal(seasonality(baseline.months, baseline.months), 0);
  assert.ok(seasonality(daisy.months, baseline.months) < 0.3);
  assert.ok(seasonality(snowdrop.months, baseline.months) > 0.8);
  assert.equal(seasonality(new Array(12).fill(0), baseline.months), 0);
});

test("grid square: whole degrees, both hemispheres, nothing for a missing position", () => {
  assert.deepEqual(cellFor(55.68, 12.57), { lat: 55, lng: 12 });
  assert.deepEqual(cellFor(-33.87, 151.21), { lat: -34, lng: 151 });
  assert.deepEqual(cellFor(-0.5, -0.5), { lat: -1, lng: -1 });
  assert.equal(cellFor(null, 12), null);
  assert.equal(cellFor("x", 12), null);
  assert.equal(cellFor(95, 12), null);
});

const realFetch = globalThis.fetch;
let gbifCalls;
beforeEach(() => {
  store._clearMemory();
  gbifCalls = [];
  globalThis.fetch = async (url) => {
    const text = String(url);
    gbifCalls.push(text);
    if (text.includes("/species/")) return Response.json({ genusKey: 2 });
    const params = new URL(text).searchParams;
    const facet = (data) => ({ count: data.count, facets: [{ counts: data.months.map((count, i) => ({ name: String(i + 1), count })) }] });
    if (params.get("taxonKey") === "6") return Response.json(facet(baseline));
    if (params.get("taxonKey") === "2") return Response.json({ count: 900 });
    return Response.json(facet(snowdrop));
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

test("rarityFor asks GBIF for the square only, and caches per species and square", async () => {
  assert.equal(await rarityFor({ gbifId: "5304" }, { lat: 55.68, lng: 12.57 }), "seasonal");
  assert.ok(gbifCalls.every((url) => !url.includes("55.68") && !url.includes("12.57")), "Only whole degrees leave the server");
  assert.ok(gbifCalls.some((url) => url.includes("decimalLatitude=55%2C56")));
  const count = gbifCalls.length;
  assert.equal(await rarityFor({ gbifId: "5304" }, { lat: 55.1, lng: 12.9 }), "seasonal");
  assert.equal(gbifCalls.length, count, "Cached");
});

test("rarityFor: no GBIF id, no position or GBIF down gives null and isn't cached", async () => {
  assert.equal(await rarityFor({ gbifId: null }, { lat: 55, lng: 12 }), null);
  assert.equal(await rarityFor({ gbifId: "5304" }, {}), null);
  assert.equal(gbifCalls.length, 0);
  globalThis.fetch = async () => new Response("down", { status: 503 });
  assert.equal(await rarityFor({ gbifId: "5304" }, { lat: 55, lng: 12 }), null);
  globalThis.fetch = async (url) => (String(url).includes("/species/") ? Response.json({ genusKey: 2 })
    : Response.json({ count: 900, facets: [{ counts: snowdrop.months.map((count, i) => ({ name: String(i + 1), count })) }] }));
  assert.notEqual(await rarityFor({ gbifId: "5304" }, { lat: 55, lng: 12 }), undefined, "Retried after the failure");
});
