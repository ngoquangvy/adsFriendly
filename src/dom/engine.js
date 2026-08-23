import { blockAdsOnPage } from "./rule-blocker.js";
import { hidePredictedAds } from "./prediction-runner.js";
import { getDomPatterns } from "../shared/pattern-store.js";

export function startStaticDomBlocker() {
  blockAdsOnPage();
  const intervalId = setInterval(blockAdsOnPage, 2000);
  return () => clearInterval(intervalId);
}

export function startLearnedDomBlocker() {
  const run = async () => {
    try {
      hidePredictedAds(await getDomPatterns());
    } catch {}
  };
  run();
  const intervalId = setInterval(run, 2000);
  return () => clearInterval(intervalId);
}

export async function runInPageEngineOnce() {
  try {
    await blockAdsOnPage();
    hidePredictedAds(await getDomPatterns());
  } catch {}
}
