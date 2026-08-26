import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITIES,
  CAPABILITY_TRIGGERS,
  getCapabilitiesForMode,
  getCapabilityDefinition,
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
  const policy = createFeaturePolicy("content.dom-candidate-collector", () => ({
    enabled: true,
    protectionMode: "assist",
  }));
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
    getCapabilitiesForMode("safe").includes(
      CAPABILITIES.NAVIGATION_REVERSE_POPUNDER,
    ),
    true,
  );
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

test("capability metadata is the single source for mode access", () => {
  const observe = getCapabilityDefinition(CAPABILITIES.MEDIA_OBSERVE);
  assert.equal(observe.minMode, "assist");
  assert.equal(observe.trigger, CAPABILITY_TRIGGERS.PASSIVE);
  assert.equal(
    getCapabilitiesForMode("assist").includes(CAPABILITIES.MEDIA_CATALOG),
    true,
  );
  assert.equal(
    getCapabilitiesForMode("safe").includes(CAPABILITIES.MEDIA_CATALOG),
    false,
  );
  assert.equal(
    getCapabilitiesForMode("safe").includes(CAPABILITIES.VIDEO_USER_ACTION),
    false,
  );
  assert.equal(
    getCapabilitiesForMode("assist").includes(CAPABILITIES.VIDEO_USER_ACTION),
    true,
  );
  assert.equal(
    getCapabilityDefinition(CAPABILITIES.VIDEO_RESTORE_STATE)
      .availableWhenDisabled,
    true,
  );
});

test("media download is an Assist user action, not a Safe capability", () => {
  const definition = getCapabilityDefinition(CAPABILITIES.MEDIA_DOWNLOAD);
  assert.equal(definition.minMode, "assist");
  assert.equal(definition.trigger, "user");
  assert.equal(getCapabilitiesForMode("safe").includes(definition.id), false);
  assert.equal(getCapabilitiesForMode("assist").includes(definition.id), true);
});

test("player source observer is centrally registered as passive media work", () => {
  const definition = getFeatureDefinition("main-world.player-source-observer");
  assert.equal(definition.context, "main-world");
  assert.deepEqual(definition.capabilities, [
    CAPABILITIES.CORE_MESSAGING,
    CAPABILITIES.MEDIA_OBSERVE,
  ]);
  assert.deepEqual(
    getFeatureDefinition("main-world.network-capture").capabilities,
    [CAPABILITIES.CORE_MESSAGING, CAPABILITIES.MEDIA_OBSERVE],
  );
  assert.deepEqual(
    getFeatureDefinition("main-world.decrypted-manifest-observer").capabilities,
    [CAPABILITIES.CORE_MESSAGING, CAPABILITIES.MEDIA_OBSERVE],
  );
});

test("background media request observation is registered with one explicit permission", () => {
  const capability = getCapabilityDefinition(
    CAPABILITIES.MEDIA_NETWORK_OBSERVE,
  );
  assert.equal(capability.minMode, "assist");
  assert.equal(capability.trigger, CAPABILITY_TRIGGERS.PASSIVE);
  assert.deepEqual(capability.browserPermissions, ["webRequest"]);
  assert.deepEqual(
    getFeatureDefinition("background.media-request-observer").capabilities,
    [CAPABILITIES.MEDIA_NETWORK_OBSERVE, CAPABILITIES.MEDIA_CATALOG],
  );
});

test("temporary media debug capture is owned by the catalog capability", () => {
  const definition = getFeatureDefinition("background.media-debug-capture");
  assert.equal(definition.context, "background");
  assert.deepEqual(definition.capabilities, [CAPABILITIES.MEDIA_CATALOG]);
});

test("legacy settings migrate deterministically", () => {
  assert.deepEqual(migrateLegacySettings({ friendlyMode: true }), {
    enabled: true,
    protectionMode: "safe",
    featureOverrides: {},
    mediaDownloadConnections: 8,
  });
  assert.equal(
    migrateLegacySettings({ friendlyMode: false }).protectionMode,
    "auto",
  );
  assert.equal(
    normalizeSettings({ protectionMode: "invalid" }).protectionMode,
    "safe",
  );
  assert.equal(normalizeSettings({}).mediaDownloadConnections, 8);
  assert.equal(
    normalizeSettings({ mediaDownloadConnections: 12 })
      .mediaDownloadConnections,
    12,
  );
  assert.equal(
    normalizeSettings({ mediaDownloadConnections: 99 })
      .mediaDownloadConnections,
    8,
  );
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
  assert(
    controller
      .snapshot()
      .activeFeatures.includes("content.dom-candidate-collector"),
  );
  assert(
    !controller
      .snapshot()
      .activeFeatures.includes("content.dom-learned-blocker"),
  );

  await controller.updateSettings({ enabled: true, protectionMode: "auto" });
  assert(
    controller
      .snapshot()
      .activeFeatures.includes("content.dom-learned-blocker"),
  );

  await controller.updateSettings({ enabled: true, protectionMode: "safe" });
  assert(
    !controller
      .snapshot()
      .activeFeatures.includes("content.dom-candidate-collector"),
  );
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

test("disabled protection keeps only background settings infrastructure alive", async () => {
  const implementations = Object.fromEntries(
    getFeaturesForContext("background").map((feature) => [
      feature.id,
      () => {},
    ]),
  );
  const controller = createMainController({
    context: "background",
    implementations,
    initialSettings: { enabled: false, protectionMode: "safe" },
    watchSettings: false,
  });
  await controller.start();
  const active = controller.snapshot().activeFeatures;
  assert(active.includes("background.message-router"));
  assert(active.includes("background.memory-cleanup"));
  assert(!active.includes("background.navigation-guard"));

  const policy = createFeaturePolicy("background.message-router", () => ({
    enabled: false,
    protectionMode: "safe",
  }));
  assert.equal(policy.can(CAPABILITIES.CORE_MESSAGING), true);
  assert.equal(policy.can(CAPABILITIES.CORE_MAINTENANCE), true);
  assert.equal(policy.can(CAPABILITIES.LEARNING_FEEDBACK), false);
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
  await assert.rejects(
    controller.start(),
    /Register it in feature-catalog\.js/,
  );
});
