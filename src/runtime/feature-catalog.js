import {
  COMPONENT_IDS,
  PRODUCT_IDS,
  assertRegisteredComponent,
  assertRegisteredProduct,
} from "./ecosystem-catalog.js";

export const PROTECTION_MODES = Object.freeze({
  SAFE: "safe",
  ASSIST: "assist",
  AUTO: "auto",
});

export const CAPABILITY_TRIGGERS = Object.freeze({
  CORE: "core",
  PASSIVE: "passive",
  USER: "user",
  SUGGESTION: "suggestion",
  AUTOMATIC: "automatic",
  STORAGE: "storage",
});

export const CAPABILITIES = Object.freeze({
  CORE_MESSAGING: "core.messaging",
  CORE_MAINTENANCE: "core.maintenance",
  NAVIGATION_GUARD: "navigation.guard",
  NAVIGATION_REVERSE_POPUNDER: "navigation.reverse_popunder",
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
  MEDIA_CATALOG: "media.catalog",
  MEDIA_DOWNLOAD: "media.download",
  MEDIA_NATIVE_DOWNLOAD: "media.native_download",
  VIDEO_OBSERVE: "video.observe",
  VIDEO_RESTORE_STATE: "video.restore_state",
  VIDEO_USER_ACTION: "video.user_action",
  VIDEO_AUTO_ACTION: "video.auto_action",
});

const C = CAPABILITIES;
const T = CAPABILITY_TRIGGERS;
const P = PRODUCT_IDS;
const R = COMPONENT_IDS;

const MODE_RANK = Object.freeze({
  [PROTECTION_MODES.SAFE]: 0,
  [PROTECTION_MODES.ASSIST]: 1,
  [PROTECTION_MODES.AUTO]: 2,
});

export const CAPABILITY_CATALOG = Object.freeze({
  [C.CORE_MESSAGING]: capability(C.CORE_MESSAGING, "safe", T.CORE, {
    availableWhenDisabled: true,
    productIds: [P.AD_PROTECTION, P.MEDIA_TOOLS],
  }),
  [C.CORE_MAINTENANCE]: capability(C.CORE_MAINTENANCE, "safe", T.CORE, {
    availableWhenDisabled: true,
    productIds: [P.AD_PROTECTION, P.MEDIA_TOOLS],
  }),
  [C.NAVIGATION_GUARD]: capability(C.NAVIGATION_GUARD, "safe", T.AUTOMATIC, {
    productIds: [P.AD_PROTECTION],
  }),
  [C.NAVIGATION_REVERSE_POPUNDER]: capability(
    C.NAVIGATION_REVERSE_POPUNDER,
    "safe",
    T.AUTOMATIC,
    { productIds: [P.AD_PROTECTION] },
  ),
  [C.NAVIGATION_INTENT]: capability(C.NAVIGATION_INTENT, "safe", T.PASSIVE, {
    productIds: [P.AD_PROTECTION],
  }),
  [C.NAVIGATION_FEEDBACK]: capability(C.NAVIGATION_FEEDBACK, "safe", T.USER, {
    productIds: [P.AD_PROTECTION],
  }),
  [C.DOM_STATIC_RULES]: capability(C.DOM_STATIC_RULES, "safe", T.AUTOMATIC, {
    productIds: [P.AD_PROTECTION],
  }),
  [C.DOM_OBSERVE]: capability(C.DOM_OBSERVE, "assist", T.PASSIVE, {
    productIds: [P.AD_PROTECTION],
  }),
  [C.DOM_SUGGEST]: capability(C.DOM_SUGGEST, "assist", T.SUGGESTION, {
    productIds: [P.AD_PROTECTION],
  }),
  [C.DOM_AUTO_HIDE]: capability(C.DOM_AUTO_HIDE, "auto", T.AUTOMATIC, {
    productIds: [P.AD_PROTECTION],
  }),
  [C.DOM_MANUAL_PICKER]: capability(C.DOM_MANUAL_PICKER, "safe", T.USER, {
    productIds: [P.AD_PROTECTION],
  }),
  [C.LEARNING_SEED]: capability(C.LEARNING_SEED, "safe", T.STORAGE, {
    productIds: [P.AD_PROTECTION],
  }),
  [C.LEARNING_FEEDBACK]: capability(C.LEARNING_FEEDBACK, "safe", T.USER, {
    productIds: [P.AD_PROTECTION],
  }),
  [C.LEARNING_APPLY]: capability(C.LEARNING_APPLY, "auto", T.AUTOMATIC, {
    productIds: [P.AD_PROTECTION],
  }),
  [C.TELEMETRY_QUEUE]: capability(C.TELEMETRY_QUEUE, "safe", T.STORAGE, {
    productIds: [P.AD_PROTECTION],
  }),
  [C.MEDIA_OBSERVE]: capability(C.MEDIA_OBSERVE, "assist", T.PASSIVE, {
    productIds: [P.AD_PROTECTION, P.MEDIA_TOOLS],
  }),
  [C.MEDIA_CATALOG]: capability(C.MEDIA_CATALOG, "assist", T.PASSIVE, {
    productIds: [P.AD_PROTECTION, P.MEDIA_TOOLS],
  }),
  [C.MEDIA_DOWNLOAD]: capability(C.MEDIA_DOWNLOAD, "assist", T.USER, {
    browserPermissions: ["storage", "tabs"],
    productIds: [P.MEDIA_TOOLS],
  }),
  [C.MEDIA_NATIVE_DOWNLOAD]: capability(
    C.MEDIA_NATIVE_DOWNLOAD,
    "assist",
    T.USER,
    {
      browserPermissions: ["nativeMessaging"],
      productIds: [P.MEDIA_TOOLS],
      requiredComponents: [R.BROWSER_EXTENSION, R.MEDIA_HELPER],
    },
  ),
  [C.VIDEO_OBSERVE]: capability(C.VIDEO_OBSERVE, "assist", T.PASSIVE, {
    productIds: [P.AD_PROTECTION],
  }),
  [C.VIDEO_RESTORE_STATE]: capability(C.VIDEO_RESTORE_STATE, "safe", T.CORE, {
    availableWhenDisabled: true,
    productIds: [P.AD_PROTECTION],
  }),
  [C.VIDEO_USER_ACTION]: capability(C.VIDEO_USER_ACTION, "assist", T.USER, {
    productIds: [P.AD_PROTECTION],
  }),
  [C.VIDEO_AUTO_ACTION]: capability(C.VIDEO_AUTO_ACTION, "auto", T.AUTOMATIC, {
    productIds: [P.AD_PROTECTION],
  }),
});

export const FEATURE_CATALOG = Object.freeze([
  feature("background.message-router", "background", C.CORE_MESSAGING, [
    C.CORE_MAINTENANCE,
    C.NAVIGATION_INTENT,
    C.NAVIGATION_FEEDBACK,
    C.LEARNING_FEEDBACK,
    C.TELEMETRY_QUEUE,
    C.MEDIA_CATALOG,
    C.MEDIA_DOWNLOAD,
  ]),
  feature("background.media-catalog", "background", C.MEDIA_CATALOG),
  feature("background.media-download-jobs", "background", C.MEDIA_DOWNLOAD, [
    C.MEDIA_NATIVE_DOWNLOAD,
  ]),
  feature("background.navigation-guard", "background", C.NAVIGATION_GUARD, [
    C.NAVIGATION_REVERSE_POPUNDER,
    C.NAVIGATION_FEEDBACK,
    C.TELEMETRY_QUEUE,
  ]),
  feature("background.telemetry-flush", "background", C.TELEMETRY_QUEUE),
  feature("background.memory-cleanup", "background", C.CORE_MAINTENANCE),
  feature("background.pattern-seed", "background", C.LEARNING_SEED),
  feature(
    "background.training-store-migration",
    "background",
    C.CORE_MAINTENANCE,
  ),
  feature("background.settings-package-seed", "background", C.CORE_MAINTENANCE),

  feature("content.media-observer", "content", C.MEDIA_OBSERVE, [
    C.MEDIA_CATALOG,
  ]),
  feature("content.youtube-cleaner", "content", C.DOM_STATIC_RULES),
  feature("content.navigation-intent", "content", C.NAVIGATION_INTENT),
  feature("content.navigation-toast", "content", C.NAVIGATION_FEEDBACK),
  feature("content.dom-static-blocker", "content", C.DOM_STATIC_RULES, [
    C.LEARNING_FEEDBACK,
    C.TELEMETRY_QUEUE,
  ]),
  feature("content.dom-candidate-collector", "content", C.DOM_OBSERVE, [
    C.DOM_SUGGEST,
    C.DOM_AUTO_HIDE,
    C.LEARNING_FEEDBACK,
  ]),
  feature("content.dom-learned-blocker", "content", C.LEARNING_APPLY, [
    C.DOM_AUTO_HIDE,
  ]),

  feature("media-frame.observer", "media-frame", C.MEDIA_OBSERVE, [
    C.MEDIA_CATALOG,
  ]),

  feature("video.surgeon", "video", C.VIDEO_OBSERVE, [
    C.VIDEO_RESTORE_STATE,
    C.VIDEO_USER_ACTION,
    C.VIDEO_AUTO_ACTION,
  ]),
  feature("picker.controller", "picker", C.DOM_MANUAL_PICKER, [
    C.LEARNING_FEEDBACK,
  ]),

  feature("main-world.network-capture", "main-world", C.MEDIA_OBSERVE),
  feature("main-world.blob-source-tracer", "main-world", C.MEDIA_OBSERVE),
  feature("main-world.eme-observer", "main-world", C.MEDIA_OBSERVE),
  feature("main-world.timer-control", "main-world", C.VIDEO_AUTO_ACTION),
]);

const CAPABILITY_SET = new Set(Object.values(CAPABILITIES));
const FEATURE_BY_ID = new Map(FEATURE_CATALOG.map((item) => [item.id, item]));

validateCatalog();

export const MODE_CAPABILITIES = Object.freeze(
  Object.fromEntries(
    Object.values(PROTECTION_MODES).map((mode) => [
      mode,
      Object.freeze(resolveCapabilitiesForMode(mode)),
    ]),
  ),
);

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
  return FEATURE_CATALOG.filter(
    (featureItem) => featureItem.context === context,
  );
}

export function getCapabilityDefinition(capabilityId) {
  assertRegisteredCapability(capabilityId);
  return CAPABILITY_CATALOG[capabilityId];
}

export function assertRegisteredCapability(capabilityId) {
  if (!CAPABILITY_SET.has(capabilityId) || !CAPABILITY_CATALOG[capabilityId]) {
    throw new Error(
      `[FeatureRegistry] Unknown capability "${capabilityId}". Register it in feature-catalog.js before use.`,
    );
  }
  return capabilityId;
}

export function getCapabilitiesForMode(mode) {
  assertProtectionMode(mode);
  return MODE_CAPABILITIES[mode];
}

export function getCapabilitiesForProduct(productId) {
  assertRegisteredProduct(productId);
  return Object.values(CAPABILITY_CATALOG)
    .filter((definition) => definition.productIds.includes(productId))
    .map((definition) => definition.id);
}

export function doesCapabilityRequireComponent(capabilityId, componentId) {
  assertRegisteredComponent(componentId);
  return getCapabilityDefinition(capabilityId).requiredComponents.includes(
    componentId,
  );
}

export function isCapabilityEnabled(capabilityId, settings = {}) {
  const definition = getCapabilityDefinition(capabilityId);
  const mode = settings.protectionMode || PROTECTION_MODES.SAFE;
  assertProtectionMode(mode);
  if (settings.enabled === false) return definition.availableWhenDisabled;
  return MODE_RANK[mode] >= MODE_RANK[definition.minMode];
}

function capability(
  id,
  minMode,
  trigger,
  {
    availableWhenDisabled = false,
    browserPermissions = [],
    productIds = [P.AD_PROTECTION, P.MEDIA_TOOLS],
    requiredComponents = [R.BROWSER_EXTENSION],
  } = {},
) {
  return Object.freeze({
    id,
    minMode,
    trigger,
    availableWhenDisabled,
    browserPermissions: Object.freeze([...browserPermissions]),
    productIds: Object.freeze([...productIds]),
    requiredComponents: Object.freeze([...requiredComponents]),
  });
}

function feature(id, context, startCapability, extraCapabilities = []) {
  return Object.freeze({
    id,
    context,
    startCapability,
    capabilities: Object.freeze([startCapability, ...extraCapabilities]),
  });
}

function resolveCapabilitiesForMode(mode) {
  assertProtectionMode(mode);
  return Object.values(CAPABILITY_CATALOG)
    .filter((definition) => MODE_RANK[mode] >= MODE_RANK[definition.minMode])
    .map((definition) => definition.id);
}

function assertProtectionMode(mode) {
  if (!(mode in MODE_RANK)) {
    throw new Error(`[FeatureRegistry] Unknown protection mode "${mode}".`);
  }
}

function validateCatalog() {
  const capabilityIds = Object.values(CAPABILITIES);
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    throw new Error("[FeatureRegistry] Duplicate capability ID.");
  }
  for (const capabilityId of capabilityIds) {
    const definition = CAPABILITY_CATALOG[capabilityId];
    if (!definition || definition.id !== capabilityId) {
      throw new Error(
        `[FeatureRegistry] Capability "${capabilityId}" has no metadata definition.`,
      );
    }
    assertProtectionMode(definition.minMode);
    if (!Object.values(CAPABILITY_TRIGGERS).includes(definition.trigger)) {
      throw new Error(
        `[FeatureRegistry] Capability "${capabilityId}" has unknown trigger "${definition.trigger}".`,
      );
    }
    if (!definition.productIds.length) {
      throw new Error(
        `[FeatureRegistry] Capability "${capabilityId}" must belong to at least one product.`,
      );
    }
    for (const productId of definition.productIds) {
      assertRegisteredProduct(productId);
    }
    if (!definition.requiredComponents.length) {
      throw new Error(
        `[FeatureRegistry] Capability "${capabilityId}" must require at least one component.`,
      );
    }
    for (const componentId of definition.requiredComponents) {
      assertRegisteredComponent(componentId);
    }
  }

  const ids = new Set();
  for (const definition of FEATURE_CATALOG) {
    if (ids.has(definition.id)) {
      throw new Error(
        `[FeatureRegistry] Duplicate feature "${definition.id}".`,
      );
    }
    ids.add(definition.id);
    if (
      new Set(definition.capabilities).size !== definition.capabilities.length
    ) {
      throw new Error(
        `[FeatureRegistry] Feature "${definition.id}" declares a capability more than once.`,
      );
    }
    for (const capabilityId of definition.capabilities) {
      assertRegisteredCapability(capabilityId);
    }
  }
}
