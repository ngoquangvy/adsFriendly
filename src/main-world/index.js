import { onContentMessage } from "./bridge.js";
import { installNetworkCapture } from "./network-capture.js";
import { installTimerControl, setAdMode } from "./timer-control.js";
console.log("[AdsFriendly Spy] Injected and active.");
installNetworkCapture();
installTimerControl();
onContentMessage((message) => {
  if (message.type === "SET_AD_MODE") setAdMode(message.value);
});
