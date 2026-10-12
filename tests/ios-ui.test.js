import test from "node:test";
import assert from "node:assert/strict";
import {
  createReviewQueue,
  createBannerReviewGate,
} from "../src/ios/review-queue.js";
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

test("pending reviews preserve the active item until it finishes", () => {
  const queue = createReviewQueue();
  const first = { key: "first" };
  queue.enqueue(first);
  assert.equal(queue.active, null);
  assert.equal(queue.take(), first);
  queue.enqueue({ key: "second" });
  assert.equal(queue.active, first);
  assert.equal(queue.take(), first);
  queue.finish();
  assert.equal(queue.active, null);
  assert.equal(queue.take().key, "second");
});

test("banner reviews survive node replacement and geometry/class churn", () => {
  const gate = createBannerReviewGate({ intervalMs: 0 });
  const banner = {};
  assert.equal(gate.record("compact:#ad-slot", banner, 0), true);
  assert.equal(gate.canPrompt("compact:#ad-slot", {}, 100000), false);
  assert.equal(gate.canPrompt("wide:.new-class", banner, 100000), false);
  assert.equal(gate.canPrompt("compact:#different-slot", {}, 100000), true);
});

test("nested banner elements are one review, not a parent/child popup train", () => {
  const gate = createBannerReviewGate({ intervalMs: 0 });
  const child = {};
  const parent = { contains: (node) => node === child };
  gate.record("parent", parent, 0);
  assert.equal(gate.canPrompt("child", child, 1), false);
  const reverse = createBannerReviewGate({ intervalMs: 0 });
  reverse.record("child", child, 0);
  assert.equal(reverse.canPrompt("parent", parent, 1), false);
});

test("automatic banners are spaced a minute apart and capped at two per document", () => {
  const gate = createBannerReviewGate();
  assert.equal(gate.record("one", {}, 0), true);
  assert.equal(gate.record("two", {}, 59999), false);
  assert.equal(gate.record("two", {}, 60000), true);
  for (let i = 0; i < 100; i++)
    assert.equal(gate.canPrompt("flood:" + i, {}, 1000000), false);
  assert.equal(createBannerReviewGate().record("new-page", {}, 0), true);
});
