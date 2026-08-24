import { CAPABILITIES } from "../runtime/feature-catalog.js";

let isAdMode = false;
let timerPolicy = null;

export function setAdMode(value) {
  isAdMode = !!value;
  console.log("[AdsFriendly Spy] Ad mode changed:", isAdMode);
}

export function installTimerControl(policy) {
  timerPolicy = policy;
  const originalTimeout = window.setTimeout;
  const originalInterval = window.setInterval;
  const timeoutWrapper = (handler, timeout, ...args) =>
    originalTimeout(handler, scaled(timeout), ...args);
  const intervalWrapper = (handler, timeout, ...args) =>
    originalInterval(handler, scaled(timeout), ...args);
  window.setTimeout = timeoutWrapper;
  window.setInterval = intervalWrapper;
  return () => {
    if (window.setTimeout === timeoutWrapper)
      window.setTimeout = originalTimeout;
    if (window.setInterval === intervalWrapper)
      window.setInterval = originalInterval;
    timerPolicy = null;
    isAdMode = false;
  };
}

function scaled(timeout) {
  return isAdMode &&
    timerPolicy?.can(CAPABILITIES.VIDEO_AUTO_ACTION) &&
    typeof timeout === "number" &&
    timeout > 50
    ? timeout / 100
    : timeout;
}
