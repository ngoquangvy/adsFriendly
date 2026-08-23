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
  window.setTimeout = (handler, timeout, ...args) =>
    originalTimeout(handler, scaled(timeout), ...args);
  window.setInterval = (handler, timeout, ...args) =>
    originalInterval(handler, scaled(timeout), ...args);
}

function scaled(timeout) {
  return isAdMode &&
    timerPolicy?.can(CAPABILITIES.VIDEO_AUTO_ACTION) &&
    typeof timeout === "number" &&
    timeout > 50
    ? timeout / 100
    : timeout;
}
