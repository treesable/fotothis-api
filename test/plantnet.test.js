import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanLatinName, parseResult, projectFor } from "../lib/plantnet.js";

test("regional project from position", () => {
  assert.equal(projectFor(55.68, 12.57), "k-northern-europe", "Copenhagen");
  assert.equal(projectFor(48.85, 2.35), "k-middle-europe", "Paris");
  assert.equal(projectFor(-33.87, 151.21), "k-australia", "Sydney");
  assert.equal(projectFor(null, null), "all");
  assert.equal(projectFor(0, -150), "all", "Middle of the Pacific");
});

test("parses Pl@ntNet's best match", () => {
  const species = parseResult({
    results: [{
      score: 0.87654,
      species: { scientificNameWithoutAuthor: "Hedera helix", commonNames: ["common ivy", "English ivy"],
        family: { scientificNameWithoutAuthor: "Araliaceae" } },
      gbif: { id: 8351737 },
    }],
  });
  assert.deepEqual(species, { commonName: "Common Ivy", scientificName: "Hedera helix", family: "Araliaceae",
    score: 0.877, gbifId: "8351737" });
  assert.equal(parseResult({ results: [] }), null);
  assert.equal(parseResult(null), null);
});

test("no common name falls back to the Latin name", () => {
  const species = parseResult({ results: [{ score: 0.5, species: { scientificNameWithoutAuthor: "Rubus fruticosus" } }] });
  assert.equal(species.commonName, "Rubus Fruticosus");
});

test("cleans author abbreviations", () => {
  assert.equal(cleanLatinName("Hedera helix L."), "Hedera helix");
  assert.equal(cleanLatinName("Mentha ×piperita"), "Mentha × piperita");
});
