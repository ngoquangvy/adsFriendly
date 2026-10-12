import test from "node:test";
import assert from "node:assert/strict";
import {
  createNavigationTracker,
  navigationDecision,
  sameHostFamily,
} from "../src/ios/navigation.js";
const base = {
  sourceUrl: "https://source.example/page",
  targetUrl: "https://news.example/story",
};
test("URL intent matches path and query, not merely a hostname", () => {
  const intent = { url: base.targetUrl, time: 1000 };
  assert.equal(
    navigationDecision({ ...base, intent, now: 1100 }).action,
    "allow",
  );
  assert.equal(
    navigationDecision({
      ...base,
      targetUrl: "https://news.example/ad",
      intent,
      now: 1100,
    }).action,
    "review",
  );
  assert.equal(
    navigationDecision({
      ...base,
      targetUrl: "https://news.example/story?popup=1",
      intent,
      now: 1100,
    }).action,
    "review",
  );
  assert.equal(
    navigationDecision({ ...base, blocked: true, allowed: true, now: 1100 })
      .action,
    "block",
  );
  assert.equal(
    sameHostFamily("https://bank.co.uk", "https://ads.co.uk"),
    false,
  );
});
test("advertising campaigns cannot borrow the clicked link intent", () => {
  const url =
    "https://ad.example/landing?utm_source=clickadu&utm_medium=popunder";
  assert.equal(
    navigationDecision({
      ...base,
      targetUrl: url,
      intent: { url, time: 0 },
      now: 10,
    }).action,
    "review",
  );
  assert.equal(
    navigationDecision({ ...base, sourcePolicy: "allow", targetUrl: url })
      .action,
    "allow",
  );
});
test("blank and same-site intermediate redirects retain their source until expiry", () => {
  let time = 0;
  const tracker = createNavigationTracker({ now: () => time });
  const candidate = tracker.link(2, 1);
  tracker.commit({ tabId: 2, url: "about:blank" });
  tracker.commit({ tabId: 2, url: base.sourceUrl });
  assert.equal(tracker.current(2, candidate), true);
  assert.equal(tracker.candidate(2).sourceTabId, 1);
  tracker.commit({ tabId: 2, url: "https://ad.example/" });
  assert.equal(tracker.current(2, candidate), true);
  tracker.finish(2);
  assert.equal(
    tracker.link(2, 1),
    null,
    "duplicate events cannot enforce twice",
  );
  time = 31000;
  assert.ok(tracker.link(2, 1));
});
test("typed navigation cancels stale evaluation and subsequent browser tab redirects", () => {
  const tracker = createNavigationTracker();
  const candidate = tracker.link(2, 1);
  assert.equal(
    tracker.commit({
      tabId: 2,
      url: "https://bank.example/",
      transitionType: "typed",
    }),
    "user",
  );
  assert.equal(tracker.current(2, candidate), false);
  assert.equal(tracker.link(2, 1), null);
  assert.equal(
    tracker.commit({
      tabId: 2,
      url: "https://bank.example/login",
      transitionQualifiers: ["server_redirect"],
    }),
    "user",
  );
});
test("open once is consumed exactly once for the exact URL", () => {
  let time = 0;
  const tracker = createNavigationTracker({ now: () => time });
  tracker.grantOnce(base.targetUrl);
  assert.equal(tracker.consumeOnce("https://news.example/other"), false);
  assert.equal(tracker.consumeOnce(base.targetUrl), true);
  assert.equal(tracker.consumeOnce(base.targetUrl), false);
  tracker.grantOnce(base.targetUrl);
  time = 5001;
  assert.equal(tracker.consumeOnce(base.targetUrl), false);
});
test("Open once cannot be borrowed by a different web-created tab", () => {
  const tracker = createNavigationTracker();
  const token = tracker.grantOnce(base.targetUrl);
  assert.equal(tracker.consumeOnce(base.targetUrl, 99), false);
  tracker.bindOnce(token, 5);
  assert.equal(tracker.consumeOnce(base.targetUrl, 99), false);
  assert.equal(tracker.consumeOnce(base.targetUrl, 5), true);
  assert.equal(tracker.consumeOnce(base.targetUrl, 5), false);
});
test("manual imported paths allow an unknown safe destination but not remembered blocks or ad signals", () => {
  assert.equal(
    navigationDecision({ ...base, trustedPath: true }).action,
    "allow",
  );
  assert.equal(
    navigationDecision({ ...base, trustedPath: true, blocked: true }).action,
    "block",
  );
  assert.equal(
    navigationDecision({ ...base, trustedPath: true, knownAd: true }).action,
    "review",
  );
});
