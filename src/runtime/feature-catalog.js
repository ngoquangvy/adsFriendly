export const PROTECTION_MODES = Object.freeze({
  SAFE: "safe",
  ASSIST: "assist",
  AUTO: "auto",
});

export const CAPABILITIES = Object.freeze({
  CORE_MESSAGING: "core.messaging",
  CORE_MAINTENANCE: "core.maintenance",
  NAVIGATION_GUARD: "navigation.guard",
  NAVIGATION_INTENT: "navigation.intent",
  NAVIGATION_FEEDBACK: "navigation.feedback",
  DOM_STATIC_RULES: "dom.static_rules",
  DOM_OBSERVE: "dom.observe",
  DOM_SUGGEST: "dom.suggest",
  DOM_AUTO_HIDE: "dom.auto_hide",
  DOM_MANUAL_PICKER: "dom.manual_picker",
  LEARNING_SEED: "learning.seed",
  LEARNING_FEEDBACK: "learning.feedback",
  LEARNING_APPLY: "learning.apply_patterns",
  TELEMETRY_QUEUE: "telemetry.queue",
  MEDIA_OBSERVE: "media.observe",
  VIDEO_OBSERVE: "video.observe",
  VIDEO_AUTO_ACTION: "video.auto_action",
});

const C = CAPABILITIES;

export const MODE_CAPABILITIES = Object.freeze({
  [PROTECTION_MODES.SAFE]: Object.freeze([
    C.CORE_MESSAGING,
    C.CORE_MAINTENANCE,
    C.NAVIGATION_GUARD,
    C.NAVIGATION_INTENT,
    C.NAVIGATION_FEEDBACK,
    C.DOM_STATIC_RULES,
    C.DOM_MANUAL_PICKER,
    C.LEARNING_SEED,
    C.LEARNING_FEEDBACK,
    C.TELEMETRY_QUEUE,
  ]),
  [PROTECTION_MODES.ASSIST]: Object.freeze([
    C.CORE_MESSAGING,
    C.CORE_MAINTENANCE,
    C.NAVIGATION_GUARD,
    C.NAVIGATION_INTENT,
    C.NAVIGATION_FEEDBACK,
    C.DOM_STATIC_RULES,
    C.DOM_OBSERVE,
    C.DOM_SUGGEST,
    C.DOM_MANUAL_PICKER,
    C.LEARNING_SEED,
    C.LEARNING_FEEDBACK,
    C.TELEMETRY_QUEUE,
    C.MEDIA_OBSERVE,
    C.VIDEO_OBSERVE,
  ]),
  [PROTECTION_MODES.AUTO]: Object.freeze([
    C.CORE_MESSAGING,
    C.CORE_MAINTENANCE,
    C.NAVIGATION_GUARD,
    C.NAVIGATION_INTENT,
    C.NAVIGATION_FEEDBACK,
    C.DOM_STATIC_RULES,
    C.DOM_OBSERVE,
    C.DOM_SUGGEST,
    C.DOM_AUTO_HIDE,
    C.DOM_MANUAL_PICKER,
    C.LEARNING_SEED,
    C.LEARNING_FEEDBACK,
    C.LEARNING_APPLY,
    C.TELEMETRY_QUEUE,
    C.MEDIA_OBSERVE,
    C.VIDEO_OBSERVE,
    C.VIDEO_AUTO_ACTION,
  ]),
});

export const FEATURE_CATALOG = Object.freeze([
  feature("background.message-router", "background", C.CORE_MESSAGING, [
    C.CORE_MAINTENANCE,
    C.NAVIGATION_INTENT,
    C.NAVIGATION_FEEDBACK,
    C.LEARNING_FEEDBACK,
    C.TELEMETRY_QUEUE,
  ]),
  feature("background.navigation-guard", "background", C.NAVIGATION_GUARD),
  feature("background.telemetry-flush", "background", C.TELEMETRY_QUEUE),
  feature("background.memory-cleanup", "background", C.CORE_MAINTENANCE),
  feature("background.pattern-seed", "background", C.LEARNING_SEED),

  feature("content.spy-injector", "content", C.MEDIA_OBSERVE),
  feature("content.youtube-cleaner", "content", C.DOM_STATIC_RULES),
  feature("content.navigation-intent", "content", C.NAVIGATION_INTENT),
  feature("content.navigation-toast", "content", C.NAVIGATION_FEEDBACK),
  feature("content.dom-static-blocker", "content", C.DOM_STATIC_RULES),
  feature("content.dom-candidate-collector", "content", C.DOM_OBSERVE, [
    C.DOM_SUGGEST,
    C.DOM_AUTO_HIDE,
    C.LEARNING_FEEDBACK,
  ]),
  feature("content.dom-learned-blocker", "content", C.LEARNING_APPLY, [
    C.DOM_AUTO_HIDE,
  ]),

  feature("video.surgeon", "video", C.VIDEO_OBSERVE, [C.VIDEO_AUTO_ACTION]),
  feature("picker.controller", "picker", C.DOM_MANUAL_PICKER, [
    C.LEARNING_FEEDBACK,
  ]),

  feature("main-world.network-capture", "main-world", C.MEDIA_OBSERVE),
  feature("main-world.timer-control", "main-world", C.VIDEO_AUTO_ACTION),
]);

const CAPABILITY_SET = new Set(Object.values(CAPABILITIES));
const FEATURE_BY_ID = new Map(FEATURE_CATALOG.map((item) => [item.id, item]));

validateCatalog();

export function getFeatureDefinition(featureId) {
  const definition = FEATURE_BY_ID.get(featureId);
  if (!definition) {
    throw new Error(
      `[FeatureRegistry] Unknown feature "${featureId}". Register it in feature-catalog.js before use.`,
    );
  }
  return definition;
}

export function getFeaturesForContext(context) {
  return FEATURE_CATALOG.filter((featureItem) => featureItem.context === context);
}

export function assertRegisteredCapability(capability) {
  if (!CAPABILITY_SET.has(capability)) {
    throw new Error(
      `[FeatureRegistry] Unknown capability "${capability}". Register it in feature-catalog.js before use.`,
    );
  }
  return capability;
}

export function getCapabilitiesForMode(mode) {
  const capabilities = MODE_CAPABILITIES[mode];
  if (!capabilities) {
    throw new Error(`[FeatureRegistry] Unknown protection mode "${mode}".`);
  }
  return capabilities;
}

function feature(id, context, startCapability, extraCapabilities = []) {
  return Object.freeze({
    id,
    context,
    startCapability,
    capabilities: Object.freeze([startCapability, ...extraCapabilities]),
  });
}

function validateCatalog() {
  const ids = new Set();
  for (const definition of FEATURE_CATALOG) {
    if (ids.has(definition.id)) {
      throw new Error(`[FeatureRegistry] Duplicate feature "${definition.id}".`);
    }
    ids.add(definition.id);
    for (const capability of definition.capabilities) {
      assertRegisteredCapability(capability);
    }
  }
  for (const [mode, capabilities] of Object.entries(MODE_CAPABILITIES)) {
    for (const capability of capabilities) {
      if (!CAPABILITY_SET.has(capability)) {
        throw new Error(
          `[FeatureRegistry] Mode "${mode}" uses unregistered capability "${capability}".`,
        );
      }
    }
  }
}
