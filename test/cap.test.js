import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { refundId, secondsUntilReset, takeId } from "../lib/cap.js";
import { store } from "../lib/store.js";

beforeEach(() => store._clearMemory());
const now = new Date("2026-10-13T15:00:00Z");

test("trial: 3 a day, then refused", async () => {
  assert.deepEqual(await takeId("a", "trial", now), { allowed: true, remaining: 2 });
  await takeId("a", "trial", now);
  assert.deepEqual(await takeId("a", "trial", now), { allowed: true, remaining: 0 });
  assert.deepEqual(await takeId("a", "trial", now), { allowed: false, remaining: 0 });
  assert.deepEqual(await takeId("a", "trial", now), { allowed: false, remaining: 0 }, "A refusal doesn't use one up");
  assert.equal((await takeId("b", "trial", now)).allowed, true, "Per device");
  assert.equal((await takeId("a", "trial", new Date("2026-10-14T00:00:01Z"))).allowed, true, "New UTC day");
});

test("a refunded ID can be used again", async () => {
  for (let i = 0; i < 3; i++) await takeId("a", "trial", now);
  await refundId("a", "trial", now);
  assert.equal((await takeId("a", "trial", now)).allowed, true);
});

test("paid is unlimited", async () => {
  for (let i = 0; i < 10; i++) assert.deepEqual(await takeId("a", "paid", now), { allowed: true, remaining: null });
});

test("retry after = until UTC midnight", () => {
  assert.equal(secondsUntilReset(now), 9 * 3600);
});
