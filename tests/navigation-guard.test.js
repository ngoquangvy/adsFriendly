import test from "node:test";
import assert from "node:assert/strict";
import {
  REVERSE_POPUNDER_WINDOW_MS,
  isReversePopunderSequence,
  isSelfCloneNavigation,
} from "../src/navigation/background/reverse-popunder.js";

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
