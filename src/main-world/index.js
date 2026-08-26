import { onContentMessage } from "./bridge.js";
import { installNetworkCapture } from "./network-capture.js";
import { installPlayerSourceObserver } from "./player-source-observer.js";
import { installBlobSourceTracer } from "./blob-source-tracer.js";
import { installEmeObserver } from "./eme-observer.js";
import { installTimerControl, setAdMode } from "./timer-control.js";
import { createMainController } from "../runtime/main-controller.js";

const script = document.currentScript;
const initialSettings = {
  enabled: script?.dataset.protectionEnabled !== "false",
  protectionMode: script?.dataset.protectionMode || "safe",
};

const controller = createMainController({
  context: "main-world",
  initialSettings,
  watchSettings: false,
  implementations: {
    "main-world.network-capture": ({ policy }) => installNetworkCapture(policy),
    "main-world.player-source-observer": ({ policy }) =>
      installPlayerSourceObserver(policy),
    "main-world.blob-source-tracer": ({ policy }) =>
      installBlobSourceTracer(policy),
    "main-world.eme-observer": () => installEmeObserver(),
    "main-world.timer-control": ({ policy }) => installTimerControl(policy),
  },
});

onContentMessage((message) => {
  if (message.type === "SET_AD_MODE") setAdMode(message.value);
  if (message.type === "PROTECTION_SETTINGS_CHANGED")
    controller.updateSettings(message.settings);
});

console.log("[AdsFriendly Spy] Injected and controlled by MainController.");
controller
  .start()
  .catch((error) =>
    console.error("[AdsFriendly Spy] MainController failed", error),
  );
