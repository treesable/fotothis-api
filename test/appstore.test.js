import assert from "node:assert/strict";
import { test } from "node:test";
import { tierFor, tierFromStatus } from "../lib/appstore.js";

const jws = (payload) => `e30.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
const status = (code, payload) => ({ data: [{ lastTransactions: [{ status: code, signedTransactionInfo: jws(payload) }] }] });

test("active paid subscription is paid", () => {
  assert.equal(tierFromStatus(status(1, { productId: "fotothis.yearly", price: 49990 })), "paid");
  assert.equal(tierFromStatus(status(4, { productId: "fotothis.weekly", price: 9990 })), "paid", "Billing grace");
});

test("free trial, expired or nothing is trial", () => {
  assert.equal(tierFromStatus(status(1, { offerType: 1, offerDiscountType: "FREE_TRIAL", price: 0 })), "trial");
  assert.equal(tierFromStatus(status(2, { price: 49990 })), "trial", "Expired");
  assert.equal(tierFromStatus({}), "trial");
});

test("no App Store key or no transaction: trial", async () => {
  assert.equal(await tierFor(null), "trial");
  assert.equal(await tierFor("2000000123456789"), "trial", "API key not configured");
  assert.equal(await tierFor("../../etc"), "trial", "Not a transaction id");
});
