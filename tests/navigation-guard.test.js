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
import { classifyNavigationIntent } from "../src/navigation/shared/intent-classifier.js";

test("classifies the reported HitClub banner click as promotional", () => {
  const result = classifyNavigationIntent({
    sourceUrl: "https://animevietsub.work/phim/example/tap-20.html",
    intentUrl:
      "https://hitclub.voting/?a=01d52ef1408e7407ed98f13a699a6ec6&utm_source=animevietsubapp&utm_medium=topbanner2&utm_campaign=cpd&utm_content=phim",
    evidence: "IMG hitclub",
  });
  assert.equal(result.likelyAd, true);
  assert(result.reasons.includes("multiple_campaign_parameters"));
  assert(result.reasons.includes("promotional_element_or_destination"));
});

test("does not downgrade an ordinary explicitly clicked external link", () => {
  assert.equal(
    classifyNavigationIntent({
      sourceUrl: "https://example.test/article",
      intentUrl: "https://docs.example.dev/guide?utm_source=newsletter",
      evidence: "Read documentation",
    }).likelyAd,
    false,
  );
});

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
