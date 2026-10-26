import test from "node:test";
import assert from "node:assert/strict";
import { shouldAutoHideIosBanner } from "../src/ios/automatic-dom.js";

const linked = {
  visible: true,
  tag: "a",
  href: "https://unknown.test/placement",
  linkExternal: true,
  rect: { width: 320, height: 70 },
  descendants: { imageCount: 1 },
};
test("Allow, Default and Block make deliberately different decisions for the same discovered banner", () => {
  const evidence = { candidate: true, geometry: true, externalLink: true };
  assert.equal(
    shouldAutoHideIosBanner(linked, { policy: "allow", evidence }),
    false,
  );
  assert.equal(
    shouldAutoHideIosBanner(linked, { policy: "default", evidence }),
    false,
  );
  assert.equal(
    shouldAutoHideIosBanner(linked, { policy: "block", evidence }),
    true,
  );
});
test("Block restores text/CSS ad-slot and invisible click-catcher coverage without requiring an image", () => {
  const text = {
    visible: true,
    tag: "div",
    className: "ad-slot",
    textLength: 20,
    rect: { width: 300, height: 70 },
  };
  const evidence = { candidate: true, geometry: true, adContent: true };
  assert.equal(
    shouldAutoHideIosBanner(text, { policy: "block", evidence }),
    true,
  );
  assert.equal(
    shouldAutoHideIosBanner(text, { policy: "default", evidence }),
    false,
  );
  const trap = {
    visible: false,
    tag: "div",
    rect: { width: 390, height: 844 },
  };
  assert.equal(
    shouldAutoHideIosBanner(trap, {
      policy: "block",
      evidence: { candidate: true, invisibleOverlay: true },
    }),
    true,
  );
  assert.equal(
    shouldAutoHideIosBanner(trap, {
      policy: "default",
      evidence: { candidate: true, invisibleOverlay: true },
    }),
    false,
  );
});
test("Default requires corroboration, while protection-off and protected content win over Block", () => {
  const evidence = {
    candidate: true,
    geometry: true,
    directAdLink: true,
    closeButton: true,
  };
  assert.equal(
    shouldAutoHideIosBanner(linked, { policy: "default", evidence }),
    true,
  );
  assert.equal(
    shouldAutoHideIosBanner(linked, {
      policy: "default",
      evidence: { ...evidence, closeButton: false },
    }),
    false,
  );
  assert.equal(
    shouldAutoHideIosBanner(linked, {
      policy: "block",
      enabled: false,
      evidence,
    }),
    false,
  );
  assert.equal(
    shouldAutoHideIosBanner(linked, {
      policy: "block",
      evidence: { ...evidence, protectedContent: true },
    }),
    false,
  );
  assert.equal(
    shouldAutoHideIosBanner(
      { ...linked, tag: "body" },
      { policy: "block", evidence },
    ),
    false,
  );
});
