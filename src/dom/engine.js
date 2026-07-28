import { blockAdsOnPage } from "./rule-blocker.js";
import { startDomCandidateCollector } from "./collector.js";
import { hidePredictedAds } from "./prediction-runner.js";
import { getDomPatterns } from "../shared/pattern-store.js";
export function startInPageEngine() {
  startDomCandidateCollector();
  setInterval(run, 2000);
  chrome.storage.local.get(["friendlyMode", "isEnabled"], (result) => {
    if (result?.isEnabled !== false && result.friendlyMode === false)
      blockAdsOnPage();
  });
}
async function run() {
  try {
    const { friendlyMode, isEnabled } = await chrome.storage.local.get([
      "friendlyMode",
      "isEnabled",
    ]);
    if (isEnabled === false || friendlyMode !== false) return;
    await blockAdsOnPage();
    hidePredictedAds(await getDomPatterns());
  } catch {}
}
