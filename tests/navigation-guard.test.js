import test from "node:test";
import assert from "node:assert/strict";
import {
  REVERSE_POPUNDER_WINDOW_MS,
  isReversePopunderSequence,
  isSelfCloneNavigation,
} from "../src/navigation/background/reverse-popunder.js";
import {
  NEW_TAB_DECISIONS,
  NEW_TAB_REVIEW_SURFACES,
  chooseNewTabReviewSurface,
  decideNewTabNavigation,
  shouldKeepTrackingNewTab,
} from "../src/navigation/background/new-tab-policy.js";
import { isExtensionContextInvalidated } from "../src/shared/extension-context.js";
import { classifyNavigationIntent } from "../src/navigation/shared/intent-classifier.js";
import {
  getPrefilledSearchNavigation,
  resolveNavigationDecisionTarget,
} from "../src/navigation/shared/search-navigation.js";
import {
  NAVIGATION_SEQUENCES,
  createNavigationEnforcementPlan,
  getRegisteredNavigationSequences,
} from "../src/navigation/background/navigation-sequences.js";

test("registers every supported navigation sequence explicitly", () => {
  assert.deepEqual(
    [...getRegisteredNavigationSequences()].sort(),
    [
      NAVIGATION_SEQUENCES.OPENED_TAB_IS_TARGET,
      NAVIGATION_SEQUENCES.ORIGINAL_TAB_WAS_REDIRECTED,
    ].sort(),
  );
  assert.throws(
    () =>
      createNavigationEnforcementPlan({
        sequence: "future_unregistered_sequence",
        originalTabId: 1,
        openedTabId: 2,
      }),
    /Register it before use/,
  );
});

test("always notifies the surviving tab for both protection sequences", () => {
  assert.deepEqual(
    createNavigationEnforcementPlan({
      sequence: NAVIGATION_SEQUENCES.OPENED_TAB_IS_TARGET,
      originalTabId: 10,
      openedTabId: 20,
    }),
    {
      closeTabId: 20,
      restoreTabId: null,
      survivingTabId: 10,
      notifyTabId: 10,
    },
  );
  assert.deepEqual(
    createNavigationEnforcementPlan({
      sequence: NAVIGATION_SEQUENCES.ORIGINAL_TAB_WAS_REDIRECTED,
      originalTabId: 10,
      openedTabId: 20,
    }),
    {
      closeTabId: 10,
      restoreTabId: null,
      survivingTabId: 20,
      notifyTabId: 20,
    },
  );
  assert.deepEqual(
    createNavigationEnforcementPlan({
      sequence: NAVIGATION_SEQUENCES.ORIGINAL_TAB_WAS_REDIRECTED,
      originalTabId: 10,
      openedTabId: 20,
      restoreOriginal: true,
    }),
    {
      closeTabId: null,
      restoreTabId: 10,
      survivingTabId: 10,
      notifyTabId: 10,
    },
  );
});

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

test("recognizes an ad destination disguised as a Google search", () => {
  const result = classifyNavigationIntent({
    sourceUrl: "https://phimvietsub.click/watch/1",
    intentUrl:
      "https://www.google.com/search?q=777hoky256jp.live+-%E2%9A%BD%EF%B8%8F&hl=id&gl=ID",
  });
  assert.equal(result.likelyAd, true);
  assert(result.reasons.includes("prefilled_search_navigation"));
  assert(result.reasons.includes("promotional_search_destination"));
});

test("never turns a Google search wrapper into a Google domain decision", () => {
  const url =
    "https://www.google.com/search?q=777hoky256jp.live+-%E2%9A%BD%EF%B8%8F&hl=id&gl=ID";
  assert.deepEqual(getPrefilledSearchNavigation(url), {
    searchHost: "www.google.com",
    embeddedHost: "777hoky256jp.live",
  });
  assert.deepEqual(
    resolveNavigationDecisionTarget({
      action: "BLACKLIST",
      domain: "www.google.com",
      url,
    }),
    { scope: "embedded_domain", domain: "777hoky256jp.live" },
  );
  assert.deepEqual(
    resolveNavigationDecisionTarget({
      action: "WHITELIST",
      domain: "www.google.com",
      url,
    }),
    { scope: "navigation_only", domain: null },
  );
  assert.deepEqual(
    resolveNavigationDecisionTarget({
      action: "BLACKLIST",
      domain: "www.google.com",
      url: "https://www.google.com/search?q=ordinary+prefilled+query",
    }),
    { scope: "navigation_only", domain: null },
  );
});

test("treats any prefilled cross-site Google search as strong evidence", () => {
  const result = classifyNavigationIntent({
    sourceUrl: "https://video.example/watch/1",
    intentUrl: "https://www.google.com/search?q=ordinary+prefilled+query",
  });
  assert.equal(result.likelyAd, true);
  assert.deepEqual(result.reasons, ["prefilled_search_navigation"]);
  assert.equal(
    chooseNewTabReviewSurface({
      targetLikelyAd: result.likelyAd,
      targetReasons: result.reasons,
    }),
    NEW_TAB_REVIEW_SURFACES.CLOSE,
  );
});

test("recognizes promotional evidence even when an overlay has no link URL", () => {
  const result = classifyNavigationIntent({
    sourceUrl: "https://video.example/watch",
    intentUrl: null,
    evidence: "fullscreen overlay hitclub banner",
  });
  assert.equal(result.likelyAd, true);
  assert(result.reasons.includes("promotional_element_or_destination"));
});

test("recognizes an invalidated extension context", () => {
  assert.equal(
    isExtensionContextInvalidated(new Error("Extension context invalidated.")),
    true,
  );
  assert.equal(
    isExtensionContextInvalidated(new Error("network failed")),
    false,
  );
});

test("untrusted cross-site tabs require user verification", () => {
  assert.equal(decideNewTabNavigation(), NEW_TAB_DECISIONS.VERIFY);
  assert.equal(
    decideNewTabNavigation({ intentMatched: true }),
    NEW_TAB_DECISIONS.VERIFY,
  );
  assert.equal(
    decideNewTabNavigation({ whitelisted: true }),
    NEW_TAB_DECISIONS.ALLOW,
  );
  assert.equal(
    decideNewTabNavigation({ trustedTarget: true }),
    NEW_TAB_DECISIONS.ALLOW,
  );
  assert.equal(
    decideNewTabNavigation({ trustedTarget: true, targetLikelyAd: true }),
    NEW_TAB_DECISIONS.VERIFY,
  );
  assert.equal(
    decideNewTabNavigation({ trustedPath: true, targetLikelyAd: true }),
    NEW_TAB_DECISIONS.VERIFY,
  );
  assert.equal(
    decideNewTabNavigation({ blacklisted: true }),
    NEW_TAB_DECISIONS.CLOSE,
  );
  assert.equal(
    decideNewTabNavigation({ blacklisted: true, whitelisted: true }),
    NEW_TAB_DECISIONS.CLOSE,
  );
  assert.equal(
    decideNewTabNavigation({
      trustedPath: true,
      promotionalIntent: true,
    }),
    NEW_TAB_DECISIONS.VERIFY,
  );
  assert.equal(shouldKeepTrackingNewTab({ sameSite: true }), true);
  assert.equal(shouldKeepTrackingNewTab({ sameSite: false }), false);
});

test("maps weak, medium, and strong evidence to three review levels", () => {
  assert.equal(chooseNewTabReviewSurface(), NEW_TAB_REVIEW_SURFACES.TOAST);
  assert.equal(
    chooseNewTabReviewSurface({ promotionalIntent: true }),
    NEW_TAB_REVIEW_SURFACES.FULL_PAGE,
  );
  assert.equal(
    chooseNewTabReviewSurface({
      promotionalIntent: true,
      intentReasons: ["strong_tracking_parameter"],
      targetReasons: ["promotional_element_or_destination"],
    }),
    NEW_TAB_REVIEW_SURFACES.CLOSE,
  );
  assert.equal(
    chooseNewTabReviewSurface({ targetLikelyAd: true }),
    NEW_TAB_REVIEW_SURFACES.FULL_PAGE,
  );
  assert.equal(
    chooseNewTabReviewSurface({
      targetLikelyAd: true,
      targetReasons: [
        "prefilled_search_navigation",
        "promotional_search_destination",
      ],
    }),
    NEW_TAB_REVIEW_SURFACES.CLOSE,
  );
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
