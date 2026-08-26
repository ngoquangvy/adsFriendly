import { registerMessageRouter } from "./message-router.js";
import { registerNavigationGuard } from "../navigation/background/guard.js";
import { cleanupStaleMemory } from "./reputation.js";
import { seedBaselinePatterns } from "./pattern-learning.js";
import { startTelemetryFlush } from "./telemetry.js";
import { initializeBundledSettingsPackage } from "./settings-package-seed.js";
import { createMainController } from "../runtime/main-controller.js";
import { DEFAULT_SETTINGS, loadSettings } from "../runtime/settings-store.js";
import { migrateLegacyTrainingStorage } from "../storage/training-store.js";
import { startBackgroundMediaCatalog } from "./media-catalog.js";
import { startMediaDownloadJobStore } from "./media-download-jobs.js";
import { startBackgroundMediaRequestObserver } from "./media-request-observer.js";

const controller = createMainController({
  context: "background",
  initialSettings: DEFAULT_SETTINGS,
  implementations: {
    "background.message-router": ({ policy }) => registerMessageRouter(policy),
    "background.media-catalog": () => startBackgroundMediaCatalog(),
    "background.media-request-observer": () =>
      startBackgroundMediaRequestObserver(),
    "background.media-download-jobs": ({ policy }) =>
      startMediaDownloadJobStore(policy),
    "background.navigation-guard": ({ policy }) =>
      registerNavigationGuard(policy),
    "background.telemetry-flush": () => startTelemetryFlush(),
    "background.memory-cleanup": () => {
      chrome.runtime.onStartup.addListener(cleanupStaleMemory);
      cleanupStaleMemory();
      return () => chrome.runtime.onStartup.removeListener(cleanupStaleMemory);
    },
    "background.pattern-seed": () => {
      chrome.runtime.onInstalled.addListener(seedBaselinePatterns);
      seedBaselinePatterns();
      return () =>
        chrome.runtime.onInstalled.removeListener(seedBaselinePatterns);
    },
    "background.settings-package-seed": async () => {
      try {
        await initializeBundledSettingsPackage();
      } catch (error) {
        // A missing or conflicting optional default package must not prevent
        // navigation protection, messaging, or the media catalog from starting.
        console.error(
          "[AdsFriendly Background] Bundled settings initialization failed",
          error,
        );
      }
    },
    "background.training-store-migration": () => migrateLegacyTrainingStorage(),
  },
});

controller
  .start()
  .then(() =>
    loadSettings(chrome.storage.local, {
      persistMissing: true,
    }),
  )
  .then((settings) => controller.updateSettings(settings))
  .catch((error) =>
    console.error("[AdsFriendly Background] MainController failed", error),
  );
