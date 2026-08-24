import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBatch, normalizeEvent } from "./schema.js";

test("normalizes a minimal video sample", () => {
  const result = normalizeEvent({
    unit: "video_instance",
    label: "unknown",
    label_source: "heuristic_weak",
    site: {
      hostname: "Example.COM",
      url: "https://example.com/watch?token=secret&v=1#frag",
    },
    context: { duration: 30 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.event.site.hostname, "example.com");
  assert.equal(
    result.event.site.url,
    "https://example.com/watch?token=%5Bredacted%5D&v=1",
  );
  assert.equal(result.event.unit, "video_instance");
});

test("normalizes batches and rejects invalid objects", () => {
  const result = normalizeBatch({
    events: [
      { site: { hostname: "a.test" }, unit: "navigation" },
      null,
      { unit: "video_instance" },
    ],
  });

  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 2);
});

test("preserves label strength, identity, sync, and feedback metadata", () => {
  const result = normalizeEvent({
    unit: "dom_element",
    label: "ad",
    label_source: "user_block",
    label_strength: "strong",
    site: { hostname: "ads.example", url: "https://ads.example/" },
    identity: { client_id: "client-1", platform: "chrome_extension" },
    sync: { scope: "user", status: "queued" },
    feedback: { user_action: "block", surface: "dom_candidate_toast" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.event.label_strength, "strong");
  assert.equal(result.event.identity.client_id, "client-1");
  assert.equal(result.event.sync.scope, "user");
  assert.equal(result.event.feedback.user_action, "block");
});
