import { startMediaObserver } from "../content/media-observer.js";
import { createMainController } from "../runtime/main-controller.js";

if (window.top !== window) {
  const controller = createMainController({
    context: "media-frame",
    implementations: {
      "media-frame.observer": () => startMediaObserver(),
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
      console.error("[AdsFriendly Media Frame] MainController failed", error),
    );
}
