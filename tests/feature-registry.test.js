import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITIES,
  getCapabilitiesForMode,
  getFeatureDefinition,
  getFeaturesForContext,
} from "../src/runtime/feature-catalog.js";
import {
  createFeaturePolicy,
  createMainController,
} from "../src/runtime/main-controller.js";
import {
  migrateLegacySettings,
  normalizeSettings,
} from "../src/runtime/settings-store.js";

test("catalog rejects unknown features and capabilities", () => {
  assert.throws(
    () => getFeatureDefinition("content.not-registered"),
    /Register it in feature-catalog\.js/,
  );
  const policy = createFeaturePolicy(
    "content.dom-candidate-collector",
    () => ({ enabled: true, protectionMode: "assist" }),
  );
  assert.throws(
    () => policy.can(CAPABILITIES.VIDEO_AUTO_ACTION),
    /undeclared capability/,
  );
  assert.throws(
    () => policy.can("dom.not-registered"),
    /Register it in feature-catalog\.js/,
  );
});

test("mode policy separates suggestion and automatic actions", () => {
  assert.equal(
    getCapabilitiesForMode("safe").includes(CAPABILITIES.DOM_OBSERVE),
    false,
  );
  assert.equal(
    getCapabilitiesForMode("assist").includes(CAPABILITIES.DOM_SUGGEST),
    true,
  );
  assert.equal(
    getCapabilitiesForMode("assist").includes(CAPABILITIES.DOM_AUTO_HIDE),
    false,
  );
  assert.equal(
    getCapabilitiesForMode("auto").includes(CAPABILITIES.DOM_AUTO_HIDE),
    true,
  );
});

test("legacy settings migrate deterministically", () => {
  assert.deepEqual(migrateLegacySettings({ friendlyMode: true }), {
    enabled: true,
    protectionMode: "safe",
    featureOverrides: {},
  });
  assert.equal(
    migrateLegacySettings({ friendlyMode: false }).protectionMode,
    "auto",
  );
  assert.equal(normalizeSettings({ protectionMode: "invalid" }).protectionMode, "safe");
});

test("controller starts and stops catalog features when mode changes", async () => {
  const events = [];
  const implementations = Object.fromEntries(
    getFeaturesForContext("content").map((feature) => [
      feature.id,
      () => {
        events.push(`start:${feature.id}`);
        return () => events.push(`stop:${feature.id}`);
      },
    ]),
  );
  const controller = createMainController({
    context: "content",
    implementations,
    initialSettings: { enabled: true, protectionMode: "assist" },
    watchSettings: false,
    logger: { error() {} },
  });

  await controller.start();
  assert(controller.snapshot().activeFeatures.includes("content.dom-candidate-collector"));
  assert(!controller.snapshot().activeFeatures.includes("content.dom-learned-blocker"));

  await controller.updateSettings({ enabled: true, protectionMode: "auto" });
  assert(controller.snapshot().activeFeatures.includes("content.dom-learned-blocker"));

  await controller.updateSettings({ enabled: true, protectionMode: "safe" });
  assert(!controller.snapshot().activeFeatures.includes("content.dom-candidate-collector"));
  assert(events.includes("stop:content.dom-candidate-collector"));
});

test("controller invokes synchronous feature factories during startup", async () => {
  const started = [];
  const implementations = Object.fromEntries(
    getFeaturesForContext("background").map((feature) => [
      feature.id,
      () => started.push(feature.id),
    ]),
  );
  const controller = createMainController({
    context: "background",
    implementations,
    initialSettings: { enabled: true, protectionMode: "safe" },
    watchSettings: false,
  });
  const startup = controller.start();
  assert(started.includes("background.message-router"));
  assert(started.includes("background.navigation-guard"));
  await startup;
});

test("controller requires an implementation for every catalog feature", () => {
  assert.throws(
    () =>
      createMainController({
        context: "content",
        implementations: {},
        initialSettings: { enabled: true, protectionMode: "safe" },
        watchSettings: false,
      }),
    /has no implementation/,
  );
});

test("feature overrides cannot reference an unregistered feature", async () => {
  const implementations = Object.fromEntries(
    getFeaturesForContext("content").map((feature) => [feature.id, () => {}]),
  );
  const controller = createMainController({
    context: "content",
    implementations,
    initialSettings: {
      enabled: true,
      protectionMode: "safe",
      featureOverrides: { "content.not-registered": true },
    },
    watchSettings: false,
  });
  await assert.rejects(controller.start(), /Register it in feature-catalog\.js/);
});
