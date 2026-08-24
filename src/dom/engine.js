import { blockAdsOnPage } from "./rule-blocker.js";
import { hidePredictedAds } from "./prediction-runner.js";
import { getDomPatterns } from "../shared/pattern-store.js";
import { isExtensionContextInvalidated } from "../shared/extension-context.js";

export async function startStaticDomBlocker() {
  // The collector starts later in the feature catalog. Waiting here prevents
  // saved rules and candidate review from racing during the first page load.
  await blockAdsOnPage();
  return startManagedLoop(blockAdsOnPage, false);
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

function startManagedLoop(task, runImmediately = true) {
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
  if (runImmediately) run();
  return stop;
}
