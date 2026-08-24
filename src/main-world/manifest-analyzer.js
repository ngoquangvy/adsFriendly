import { notifyContentScript } from "./bridge.js";
const AD_MARKERS = [
  "#EXT-X-CUE-OUT",
  "#EXT-X-DATERANGE",
  "adunit",
  "vpaid",
  "doubleclick",
];
export function analyzeManifest(url, body) {
  if (!AD_MARKERS.some((marker) => body.includes(marker))) return;
  console.log("[AdsFriendly Spy] Ad segment detected in manifest:", url);
  notifyContentScript({ type: "AD_MAP_DETECTED", url });
}
