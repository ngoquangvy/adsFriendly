import test from "node:test";
import assert from "node:assert/strict";
import {
  storageValuesEqual,
  isStorageQuotaError,
} from "../src/shared/storage-verification.js";

test("stored settings are compared by values, not JSON property insertion order", () => {
  assert.equal(
    storageValuesEqual(
      { fingerprint: { id: "ad", tag: "div" }, selector: "#ad" },
      {
        selector: "#ad",
        fingerprint: { tag: "div", id: "ad", title: undefined },
      },
    ),
    true,
  );
  assert.equal(storageValuesEqual(["a", "b"], ["b", "a"]), false);
  assert.equal(storageValuesEqual({ id: "new" }, { id: "old" }), false);
  assert.equal(storageValuesEqual(null, undefined), false);
});

test("quota labels require a quota error, not an arbitrary storage/bytes message", () => {
  for (const message of [
    "QUOTA_BYTES quota exceeded",
    "Settings storage is full",
    "Quota limit reached",
    "storage is full",
  ])
    assert.equal(isStorageQuotaError(new Error(message)), true, message);
  for (const message of [
    "Storage verification failed",
    "Settings storage is full: Storage verification failed",
    "Storage unavailable",
    "getBytesInUse unavailable",
    "Message port closed",
  ])
    assert.equal(isStorageQuotaError(new Error(message)), false, message);
});
