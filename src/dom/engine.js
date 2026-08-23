import { blockAdsOnPage } from "./rule-blocker.js";
import { hidePredictedAds } from "./prediction-runner.js";
import { getDomPatterns } from "../shared/pattern-store.js";
import { isExtensionContextInvalidated } from "../shared/extension-context.js";

export function startStaticDomBlocker() {
  return startManagedLoop(blockAdsOnPage);
}

export function startLearnedDomBlocker() {
  return startManagedLoop(async () => {
    hidePredictedAds(await getDomPatterns());
  });
}

export async function runInPageEngineOnce() {
  try {
    await blockAdsOnPage();
    hidePredictedAds(await getDomPatterns());
  } catch {}
}

function startManagedLoop(task) {
  let stopped = false;
  let intervalId = null;
  const stop = () => {
    stopped = true;
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  };
  const run = async () => {
    if (stopped) return;
    try {
      await task();
    } catch (error) {
      if (isExtensionContextInvalidated(error)) stop();
    }
  };
  intervalId = setInterval(run, 2000);
  run();
  return stop;
}
