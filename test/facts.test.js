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
  assert.equal(cacheKey("Hedera helix", "da"), "facts:v1:da:hedera helix");
});
