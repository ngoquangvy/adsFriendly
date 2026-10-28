import test from "node:test";
import assert from "node:assert/strict";
import {
  createNavigationAttribution,
  ATTRIBUTION_EVIDENCE as E,
  navigationAttributionFacts,
} from "../src/navigation/background/attribution.js";
import { createManagedTabRegistry } from "../src/navigation/background/managed-tabs.js";
import { constrainNavigationEnforcement } from "../src/navigation/background/enforcement-policy.js";
import { createUserNavigationTracker } from "../src/navigation/background/user-navigation.js";

test("navigation owns an immutable frame-scoped intent, not the latest click", () => {
  let now = 100;
  const store = createNavigationAttribution({ now: () => now });
  const click = {
    tabId: 1,
    sourceFrameId: 7,
    sourceUrl: "https://source.test/",
    intentUrl: "https://one.test/",
    intentReasons: ["one"],
  };
  store.rememberIntent(click);
  const first = store.link({
    targetTabId: 2,
    sourceTabId: 1,
    sourceFrameId: 7,
    evidence: E.WEB_TARGET,
  });
  click.intentReasons.push("changed");
  now++;
  store.rememberIntent({ ...click, intentUrl: "https://two.test/" });
  assert.equal(first.intent.intentUrl, "https://one.test/");
  assert.deepEqual(first.intent.intentReasons, ["one"]);
  assert.equal(
    store.link({
      targetTabId: 3,
      sourceTabId: 1,
      sourceFrameId: 0,
      evidence: E.WEB_TARGET,
    }).intent,
    null,
  );
  assert.equal(
    store.link({ targetTabId: 4, sourceTabId: 1, evidence: E.RECENT_CLICK })
      .attribution,
    "unconfirmed",
  );
});

test("strong source evidence upgrades weak correlation and invalidates its old revision", () => {
  const store = createNavigationAttribution();
  const weak = store.link({
    targetTabId: 2,
    sourceTabId: 1,
    evidence: E.RECENT_CLICK,
  });
  const strong = store.link({
    targetTabId: 2,
    sourceTabId: 3,
    sourceFrameId: 4,
    evidence: E.WEB_TARGET,
  });
  assert.equal(strong.sourceTabId, 3);
  assert.equal(strong.attribution, "confirmed");
  assert.equal(store.isCurrent(weak), false);
  assert.equal(
    store.link({ targetTabId: 2, sourceTabId: 1, evidence: E.OPENER }),
    strong,
  );
  store.invalidate(2);
  assert.equal(store.isCurrent(strong), false);
});

test("upgrading a frame cannot retain a click from another iframe, and a new navigation gets a fresh snapshot", () => {
  const store = createNavigationAttribution();
  store.rememberIntent({
    tabId: 1,
    sourceFrameId: 7,
    sourceUrl: "https://source.test/",
    intentUrl: "https://one.test/",
  });
  const weak = store.link({
    targetTabId: 2,
    sourceTabId: 1,
    targetUrl: "https://one.test/",
    evidence: E.RECENT_CLICK,
  });
  const frame = store.link({
    targetTabId: 2,
    sourceTabId: 1,
    sourceFrameId: 0,
    targetUrl: "https://one.test/",
    evidence: E.WEB_TARGET,
  });
  assert.equal(frame.intent, null);
  assert.equal(store.isCurrent(weak), false);
  store.rememberIntent({
    tabId: 1,
    sourceFrameId: 0,
    sourceUrl: "https://source.test/",
    intentUrl: "https://two.test/",
  });
  const next = store.link({
    targetTabId: 2,
    sourceTabId: 1,
    sourceFrameId: 0,
    targetUrl: "https://two.test/",
    evidence: E.WEB_TARGET,
  });
  assert.notEqual(next.navigationId, frame.navigationId);
  assert.equal(next.intent.intentUrl, "https://two.test/");
});

test("bounded contexts expire and no raw intent or URL enters exported facts", () => {
  let now = 1;
  const store = createNavigationAttribution({ now: () => now, maximum: 2 });
  for (let targetTabId = 1; targetTabId <= 3; targetTabId++)
    store.link({
      targetTabId,
      sourceTabId: 9,
      targetUrl: "https://private.test/?token=secret",
      evidence: E.OPENER,
    });
  assert.equal(store.get(1), null);
  assert.equal(
    JSON.stringify(navigationAttributionFacts(store.get(3))).includes("secret"),
    false,
  );
  now += 10001;
  assert.equal(store.get(3), null);
});

test("managed creation handles event-before-callback and does not exempt a same-URL website tab", async () => {
  const registry = createManagedTabRegistry();
  let finish;
  const opening = registry.open(
    { url: "https://docs.test/", windowId: 4 },
    {
      create: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  );
  const actual = { id: 10, pendingUrl: "https://docs.test/", windowId: 4 };
  const unrelated = { ...actual, id: 11 };
  assert.equal(registry.hasPending(actual), true);
  const receipt = registry.waitForCreatedTab(actual);
  const other = registry.waitForCreatedTab(unrelated);
  finish({ id: 10 });
  await opening;
  assert.equal(await receipt, true);
  assert.equal(await other, false);
  assert.equal(registry.owns(10, "https://ads.test/"), null);
  registry.removeTab(10);
  assert.equal(registry.owns(10, actual.pendingUrl), null);
});

test("failed managed creation leaves no exemption", async () => {
  const registry = createManagedTabRegistry();
  await assert.rejects(
    registry.open(
      { url: "https://docs.test/" },
      {
        create: async () => {
          throw new Error("failed");
        },
      },
    ),
  );
  assert.equal(registry.hasPending({ url: "https://docs.test/" }), false);
});

test("both enforcement branches cannot escalate guessed sources into destructive actions", () => {
  for (const decision of ["close", "verify"]) {
    for (const attribution of ["unconfirmed", "probable"]) {
      const result = constrainNavigationEnforcement(
        { origin: "website", attribution },
        { decision, reviewSurface: "full_page", targetLikelyAd: true },
      );
      assert.equal(result.decision, "verify");
      assert.equal(result.reviewSurface, "toast");
      assert.equal(result.mayReplacePage, false);
    }
  }
  assert.equal(
    constrainNavigationEnforcement(
      { attribution: "unconfirmed" },
      { decision: "verify" },
    ).decision,
    "allow",
  );
  assert.equal(
    constrainNavigationEnforcement(
      { origin: "extension", attribution: "confirmed" },
      { decision: "close" },
    ).decision,
    "allow",
  );
  assert.equal(
    constrainNavigationEnforcement(
      { origin: "website", attribution: "confirmed" },
      { decision: "close" },
    ).decision,
    "close",
  );
});

test("user navigation carries across matching Google redirects only, with TTL and hop limits", () => {
  let now = 100;
  const tracker = createUserNavigationTracker({ now: () => now });
  tracker.begin(1, "https://www.google.com/search?q=user-query");
  const details = {
    tabId: 1,
    url: "https://www.google.com.vn/search?q=user-query",
    transitionQualifiers: ["server_redirect"],
  };
  assert.equal(
    tracker.continueRedirect({ ...details, transitionQualifiers: [] }),
    false,
  );
  assert.equal(
    tracker.continueRedirect({
      ...details,
      url: "https://www.google.com.vn/search?q=ad-query",
    }),
    false,
  );
  assert.equal(
    tracker.continueRedirect({ ...details, url: "https://ad.test/" }),
    false,
  );
  for (let i = 0; i < 5; i++)
    assert.equal(tracker.continueRedirect(details), true);
  assert.equal(tracker.continueRedirect(details), false);
  tracker.begin(1, "https://source.test/");
  now += 10001;
  assert.equal(
    tracker.continueRedirect({ ...details, url: "https://sub.source.test/" }),
    false,
  );
});
