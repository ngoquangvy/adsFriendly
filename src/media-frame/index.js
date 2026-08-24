import { startMediaObserver } from "../content/media-observer.js";
import { createMainController } from "../runtime/main-controller.js";

if (window.top !== window) {
  const controller = createMainController({
    context: "media-frame",
    implementations: {
      "media-frame.observer": () => startMediaObserver(),
    },
  });

  controller
    .start()
    .catch((error) =>
      console.error("[AdsFriendly Media Frame] MainController failed", error),
    );
}
