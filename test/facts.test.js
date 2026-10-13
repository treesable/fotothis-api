import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheKey, parseFacts } from "../lib/facts.js";

test("parses the JSON array, ignoring stray text", () => {
  assert.deepEqual(parseFacts('Sure!\n["One.", " Two. ", "Three.", "Four."]'), ["One.", "Two.", "Three."]);
  assert.deepEqual(parseFacts('[{"category":"x","text":"Old shape."}]'), ["Old shape."]);
  assert.deepEqual(parseFacts("no json"), []);
  assert.deepEqual(parseFacts("[broken"), []);
});

test("cache key per species and language", () => {
  assert.equal(cacheKey("Hedera helix", "da"), "facts:v3:da:hedera helix");
});

import { prompt } from "../lib/facts.js";
import { cleanExtract } from "../lib/wikipedia.js";

test("with an article, facts may only come from it", () => {
  const text = prompt({ commonName: "Common Ivy", scientificName: "Hedera helix" }, "Ivy is an evergreen climber.");
  assert.match(text, /Use ONLY facts stated in the source text/);
  assert.match(text, /Ivy is an evergreen climber\./);
  assert.match(prompt({ commonName: "X", scientificName: "Y z" }, null), /Return \[\] if you're not certain/);
});

test("Wikipedia extract: headings dropped, stubs ignored", () => {
  const long = "A".repeat(320);
  assert.equal(cleanExtract(`${long}\n\n\n== Description ==\nTall.`), `${long}\nTall.`);
  assert.equal(cleanExtract("Too short."), null);
  assert.equal(cleanExtract(undefined), null);
});
