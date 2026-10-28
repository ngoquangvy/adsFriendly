import test from "node:test";
import assert from "node:assert/strict";
import {
  createNavigationDiagnostics,
  NAVIGATION_DIAGNOSTICS_SESSION_KEY,
  normalizeNavigationDiagnosticEvent,
} from "../src/navigation/background/diagnostics.js";

function createSessionStorage() {
  const values = new Map();
  return {
    async get(key) {
      return { [key]: values.get(key) };
    },
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) values.set(key, value);
    },
    async remove(key) {
      values.delete(key);
    },
  };
}

test("navigation trace keeps transition metadata but strips URL query values", () => {
  const event = normalizeNavigationDiagnosticEvent(
    {
      type: "navigation_committed",
      tabId: 4,
      sourceUrl: "https://animevietsub.nl/watch?id=private-value",
      url: "https://www.google.com/search?q=phim+viet+sub&auth=secret",
      transitionType: "generated",
      transitionQualifiers: ["from_address_bar"],
    },
    123,
  );

  assert.deepEqual(event, {
    at: 123,
    type: "navigation_committed",
    tabId: 4,
    sourceUrlHost: "animevietsub.nl",
    urlHost: "www.google.com",
    searchQueryPresent: true,
    transitionType: "generated",
    transitionQualifiers: ["from_address_bar"],
  });
  assert.equal(JSON.stringify(event).includes("phim+viet+sub"), false);
  assert.equal(JSON.stringify(event).includes("secret"), false);
});

test("navigation trace is bounded and survives through session storage", async () => {
  const storage = createSessionStorage();
  const diagnostics = createNavigationDiagnostics({
    getStorage: () => storage,
    now: () => 10_000,
  });

  await Promise.all(
    Array.from({ length: 140 }, (_, index) =>
      diagnostics.record({ type: "policy_decided", tabId: index, decision: "allow" }),
    ),
  );

  const snapshot = await diagnostics.getSnapshot();
  assert.equal(snapshot.events.length, 120);
  assert.equal(snapshot.events[0].tabId, 20);
  assert.equal(
    (await storage.get(NAVIGATION_DIAGNOSTICS_SESSION_KEY))[
      NAVIGATION_DIAGNOSTICS_SESSION_KEY
    ].events.length,
    120,
  );
});

test("developer capture extends trace retention and can be stopped or cleared", async () => {
  const storage = createSessionStorage();
  let now = 1_000;
  const diagnostics = createNavigationDiagnostics({
    getStorage: () => storage,
    now: () => now,
  });

  await diagnostics.record({ type: "tab_created", tabId: 8 });
  const started = await diagnostics.startCapture({
    durationMs: 20 * 60 * 1000,
    reason: "developer_test",
  });
  assert.equal(started.status, "capturing");
  assert.equal(started.captureUntil, now + 15 * 60 * 1000);

  now += 10 * 60 * 1000;
  await diagnostics.record({ type: "navigation_committed", tabId: 8 });
  let snapshot = await diagnostics.getSnapshot();
  assert.equal(snapshot.events.length, 3);
  assert.equal(snapshot.captureReason, "developer_test");

  await diagnostics.stopCapture();
  snapshot = await diagnostics.getSnapshot();
  assert.equal(snapshot.captureUntil, 0);
  assert.equal(snapshot.events.length, 3);
  assert.ok(snapshot.retainedUntil > now);

  await diagnostics.clear();
  snapshot = await diagnostics.getSnapshot();
  assert.deepEqual(snapshot.events, []);
});
