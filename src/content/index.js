import { injectSpy } from "./spy-injector.js";
import { startIntentTracker } from "../navigation/content/intent-tracker.js";
import { startDomCandidateCollector } from "../dom/collector.js";
import {
  startLearnedDomBlocker,
  startStaticDomBlocker,
} from "../dom/engine.js";
import { startNavigationToast } from "../navigation/content/navigation-toast.js";
import { startYouTubeCleaner } from "../dom/youtube-cleaner.js";
import { createMainController } from "../runtime/main-controller.js";
import { startMediaObserver } from "./media-observer.js";

const controller = createMainController({
  context: "content",
  implementations: {
    "content.spy-injector": ({ controller: main }) =>
      injectSpy(main.snapshot().settings),
    "content.media-observer": () => startMediaObserver(),
    "content.youtube-cleaner": () => startYouTubeCleaner(),
    "content.navigation-intent": () => startIntentTracker(),
    "content.navigation-toast": () => startNavigationToast(),
    "content.dom-static-blocker": () => startStaticDomBlocker(),
    "content.dom-candidate-collector": ({ policy }) =>
      startDomCandidateCollector(policy),
    "content.dom-learned-blocker": () => startLearnedDomBlocker(),
  },
});

controller.onChange(({ settings }) => {
  window.postMessage(
    {
      source: "adsfriendly-content",
      type: "PROTECTION_SETTINGS_CHANGED",
      settings,
    },
    "*",
  );
});

controller
  .start()
  .catch((error) =>
    console.error("[AdsFriendly Content] MainController failed", error),
  );
