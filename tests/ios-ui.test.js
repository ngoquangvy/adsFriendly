import test from "node:test";
import assert from "node:assert/strict";
import { createReviewQueue } from "../src/ios/review-queue.js";
test("reviews never combine unrelated popup hosts and don't drop a banner behind a popup", () => {
  const queue = createReviewQueue();
  queue.enqueue({ key: "popup:a.example", url: "https://a.example/a" });
  queue.enqueue({ key: "popup:b.example", url: "https://b.example/b" });
  queue.enqueue({ key: "banner:one" });
  assert.equal(queue.take().url, "https://a.example/a");
  assert.equal(queue.enqueue({ key: "popup:a.example" }), false);
  queue.finish();
  assert.equal(queue.take().url, "https://b.example/b");
  queue.finish();
  assert.equal(queue.take().key, "banner:one");
});
test("review queue is bounded even when a page floods popup requests", () => {
  const queue = createReviewQueue({ limit: 3 });
  for (let i = 0; i < 100; i++) queue.enqueue({ key: i });
  assert.equal(queue.size, 3);
});
