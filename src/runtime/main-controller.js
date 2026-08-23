import {
  CAPABILITIES,
  assertRegisteredCapability,
  getCapabilitiesForMode,
  getFeatureDefinition,
  getFeaturesForContext,
} from "./feature-catalog.js";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  subscribeSettings,
} from "./settings-store.js";

export function createMainController({
  context,
  implementations,
  initialSettings = null,
  watchSettings = true,
  settingsLoader = loadSettings,
  settingsSubscriber = subscribeSettings,
  logger = console,
}) {
  const catalogFeatures = getFeaturesForContext(context);
  validateImplementations(context, catalogFeatures, implementations);

  let settings = normalizeSettings(initialSettings || DEFAULT_SETTINGS);
  let unsubscribe = null;
  let started = false;
  const lifecycles = new Map();
  const listeners = new Set();

  const controller = {
    context,
    async start() {
      if (started) return controller;
      started = true;
      if (!initialSettings) settings = await settingsLoader();
      await reconcile();
      if (watchSettings) {
        unsubscribe = settingsSubscriber((nextSettings) => {
          controller
            .updateSettings(nextSettings)
            .catch((error) =>
              logger.error(
                `[MainController:${context}] reconcile failed`,
                error,
              ),
            );
        });
      }
      notify();
      return controller;
    },
    async updateSettings(nextSettings) {
      settings = normalizeSettings(nextSettings);
      if (started) await reconcile();
      notify();
      return controller.snapshot();
    },
    snapshot() {
      return {
        context,
        settings: {
          ...settings,
          featureOverrides: { ...settings.featureOverrides },
        },
        activeFeatures: [...lifecycles.entries()]
          .filter(([, lifecycle]) => lifecycle.active)
          .map(([featureId]) => featureId),
      };
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async stop() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      for (const [featureId, lifecycle] of lifecycles) {
        await stopLifecycle(featureId, lifecycle);
      }
      lifecycles.clear();
      started = false;
    },
  };

  async function reconcile() {
    validateFeatureOverrides(settings.featureOverrides);
    for (const definition of catalogFeatures) {
      const desired = shouldStartFeature(definition, settings);
      const lifecycle = lifecycles.get(definition.id);
      if (desired && !lifecycle?.active) {
        const policy = createFeaturePolicy(definition, () => settings);
        if (lifecycle?.started && !lifecycle.cleanup) {
          lifecycle.active = true;
          continue;
        }
        const result = implementations[definition.id]({
          controller,
          feature: definition,
          policy,
        });
        const cleanup = isPromiseLike(result) ? await result : result;
        lifecycles.set(definition.id, {
          active: true,
          started: true,
          cleanup: typeof cleanup === "function" ? cleanup : null,
        });
      } else if (!desired && lifecycle?.active) {
        if (lifecycle.cleanup) {
          await stopLifecycle(definition.id, lifecycle);
          lifecycles.delete(definition.id);
        } else {
          lifecycle.active = false;
        }
      }
    }
  }

  async function stopLifecycle(featureId, lifecycle) {
    if (!lifecycle.cleanup) {
      lifecycle.active = false;
      return;
    }
    try {
      await lifecycle.cleanup();
    } catch (error) {
      logger.error(
        `[MainController:${context}] failed to stop ${featureId}`,
        error,
      );
    }
    lifecycle.active = false;
  }

  function notify() {
    const snapshot = controller.snapshot();
    for (const listener of listeners) listener(snapshot);
  }

  return controller;
}

export function createFeaturePolicy(definitionOrId, readSettings) {
  const definition =
    typeof definitionOrId === "string"
      ? getFeatureDefinition(definitionOrId)
      : definitionOrId;
  const declared = new Set(definition.capabilities);

  function assertAllowed(capability) {
    assertRegisteredCapability(capability);
    if (!declared.has(capability)) {
      throw new Error(
        `[FeatureRegistry] Feature "${definition.id}" tried to use undeclared capability "${capability}". Add it to that feature in feature-catalog.js.`,
      );
    }
  }

  return Object.freeze({
    featureId: definition.id,
    can(capability) {
      assertAllowed(capability);
      const settings = readSettings();
      if (!settings.enabled)
        return [
          CAPABILITIES.CORE_MESSAGING,
          CAPABILITIES.CORE_MAINTENANCE,
        ].includes(capability);
      return getCapabilitiesForMode(settings.protectionMode).includes(
        capability,
      );
    },
    require(capability) {
      if (!this.can(capability)) {
        const settings = readSettings();
        throw new Error(
          `[FeatureRegistry] Capability "${capability}" is disabled for feature "${definition.id}" in mode "${settings.protectionMode}".`,
        );
      }
      return true;
    },
  });
}

function shouldStartFeature(definition, settings) {
  const override = settings.featureOverrides?.[definition.id];
  if (override === false) return false;
  if (
    [CAPABILITIES.CORE_MESSAGING, CAPABILITIES.CORE_MAINTENANCE].includes(
      definition.startCapability,
    )
  )
    return true;
  if (!settings.enabled) return false;
  return getCapabilitiesForMode(settings.protectionMode).includes(
    definition.startCapability,
  );
}

function validateFeatureOverrides(featureOverrides = {}) {
  for (const featureId of Object.keys(featureOverrides)) {
    getFeatureDefinition(featureId);
  }
}

function isPromiseLike(value) {
  return value && typeof value.then === "function";
}

function validateImplementations(context, catalogFeatures, implementations) {
  const expected = new Set(catalogFeatures.map((feature) => feature.id));
  for (const featureId of Object.keys(implementations)) {
    const definition = getFeatureDefinition(featureId);
    if (definition.context !== context) {
      throw new Error(
        `[FeatureRegistry] Feature "${featureId}" belongs to context "${definition.context}", not "${context}".`,
      );
    }
  }
  for (const featureId of expected) {
    if (typeof implementations[featureId] !== "function") {
      throw new Error(
        `[FeatureRegistry] Feature "${featureId}" is registered for context "${context}" but has no implementation in its main feature list.`,
      );
    }
  }
}
