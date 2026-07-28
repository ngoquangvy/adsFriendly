import { getVideoPatterns } from "../shared/pattern-store.js";
import { videoState } from "./state.js";

export async function loadPatternsAndReputation() {
  try {
    const { siteReputation = {} } =
      await chrome.storage.local.get("siteReputation");
    videoState.cachedPatterns = await getVideoPatterns();
    const rep = siteReputation[location.hostname];
    if (rep) videoState.siteTrustScore = rep.trustScore;
    console.log(
      `[AdsFriendly Video] Brain Synced. Site Trust: ${videoState.siteTrustScore.toFixed(2)}`,
    );
  } catch {}
}
