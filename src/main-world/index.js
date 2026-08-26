import { notifyContentScript, onContentMessage } from "./bridge.js";
import { installNetworkCapture } from "./network-capture.js";
import { installPlayerSourceObserver } from "./player-source-observer.js";
import { installBlobSourceTracer } from "./blob-source-tracer.js";
import { installDecryptedManifestObserver } from "./decrypted-manifest-observer.js";
import { installEmeObserver } from "./eme-observer.js";
import { installTimerControl, setAdMode } from "./timer-control.js";
import { createMainController } from "../runtime/main-controller.js";
import { getAesKeyHandoffs } from "./aes-key-handoff.js";

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
    "main-world.decrypted-manifest-observer": ({ policy }) =>
      installDecryptedManifestObserver(policy),
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
  if (message.type === "GET_MEDIA_AES_KEY_HANDOFF") {
    notifyContentScript({
      type: "MEDIA_AES_KEY_HANDOFF_RESPONSE",
      requestId: message.requestId,
      requestedManifestUrl: message.requestedManifestUrl,
      manifestUrls: message.manifestUrls,
      keys: getAesKeyHandoffs(message.manifestUrls),
    });
  }
});

console.log("[AdsFriendly Spy] Injected and controlled by MainController.");
controller
  .start()
  .catch((error) =>
    console.error("[AdsFriendly Spy] MainController failed", error),
  );
