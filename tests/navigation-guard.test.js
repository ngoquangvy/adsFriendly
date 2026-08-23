import test from "node:test";
import assert from "node:assert/strict";
import {
  REVERSE_POPUNDER_WINDOW_MS,
  isReversePopunderSequence,
  isSelfCloneNavigation,
} from "../src/navigation/background/reverse-popunder.js";
import {
  NEW_TAB_DECISIONS,
  decideNewTabNavigation,
  shouldKeepTrackingNewTab,
} from "../src/navigation/background/new-tab-policy.js";
import { isExtensionContextInvalidated } from "../src/shared/extension-context.js";

test("recognizes an invalidated extension context", () => {
  assert.equal(
    isExtensionContextInvalidated(
      new Error("Extension context invalidated."),
    ),
    true,
  );
  assert.equal(isExtensionContextInvalidated(new Error("network failed")), false);
});

test("untrusted cross-site tabs require user verification", () => {
  assert.equal(decideNewTabNavigation(), NEW_TAB_DECISIONS.VERIFY);
  assert.equal(
    decideNewTabNavigation({ intentMatched: true }),
    NEW_TAB_DECISIONS.ALLOW,
  );
  assert.equal(
    decideNewTabNavigation({ whitelisted: true }),
    NEW_TAB_DECISIONS.ALLOW,
  );
  assert.equal(
    decideNewTabNavigation({ blacklisted: true }),
    NEW_TAB_DECISIONS.CLOSE,
  );
  assert.equal(shouldKeepTrackingNewTab({ sameSite: true }), true);
  assert.equal(shouldKeepTrackingNewTab({ sameSite: false }), false);
});

test("recognizes a same-site clone", () => {
  assert.equal(
    isSelfCloneNavigation(
      "https://watch.example/video/12",
      "https://watch.example/video/12?copy=1",
    ),
    true,
  );
  assert.equal(
    isSelfCloneNavigation(
      "https://watch.example/video/12",
      "https://watch.example/video/13",
    ),
    false,
  );
});

test("detects a reverse pop-under inside the protection window", () => {
  assert.equal(
    isReversePopunderSequence({
      originalUrl: "https://watch.example/video/12",
      cloneUrl: "https://watch.example/video/12",
      redirectedUrl: "https://ads.example-cdn.test/landing?zoneid=42",
      elapsedMs: 850,
    }),
    true,
  );
});

test("does not flag normal or stale navigation sequences", () => {
  assert.equal(
    isReversePopunderSequence({
      originalUrl: "https://watch.example/video/12",
      cloneUrl: "https://docs.example.test/article",
      redirectedUrl: "https://ads.example-cdn.test/landing",
      elapsedMs: 500,
    }),
    false,
  );
  assert.equal(
    isReversePopunderSequence({
      originalUrl: "https://watch.example/video/12",
      cloneUrl: "https://watch.example/video/12",
      redirectedUrl: "https://watch.example/next",
      elapsedMs: 500,
    }),
    false,
  );
  assert.equal(
    isReversePopunderSequence({
      originalUrl: "https://watch.example/video/12",
      cloneUrl: "https://watch.example/video/12",
      redirectedUrl: "https://ads.example-cdn.test/landing",
      elapsedMs: REVERSE_POPUNDER_WINDOW_MS + 1,
    }),
    false,
  );
});
