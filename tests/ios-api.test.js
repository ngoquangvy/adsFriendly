import test from "node:test";
import assert from "node:assert/strict";
import { callApi } from "../src/ios/shared.js";
test("iOS API adapter accepts callbacks, promises and rejections without invoking mutations twice", async () => {
  assert.equal(
    await callApi(
      {
        op(cb) {
          cb(0);
        },
      },
      "op",
    ),
    0,
  );
  let calls = 0;
  const value = await Promise.race([
    callApi(
      {
        op() {
          calls++;
          return Promise.resolve("promise");
        },
      },
      "op",
    ),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 100)),
  ]);
  assert.equal(value, "promise");
  assert.equal(calls, 1);
  await assert.rejects(
    callApi(
      {
        op() {
          return Promise.reject(new Error("Denied"));
        },
      },
      "op",
    ),
    /Denied/,
  );
});
