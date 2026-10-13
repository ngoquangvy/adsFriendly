import {
  NEW_TAB_DECISIONS,
  NEW_TAB_REVIEW_SURFACES,
} from "./new-tab-policy.js";

// Shared action ceiling for BOTH new tabs and reverse popunders. Source certainty
// and ad classification are independent; time correlation alone is never consent
// to close a tab, restore a URL, or substitute a blocking page.
export function constrainNavigationEnforcement(context, evaluation) {
  if (context?.origin === "extension" || context?.origin === "browser-ui") {
    return {
      ...evaluation,
      decision: NEW_TAB_DECISIONS.ALLOW,
      reviewSurface: null,
      attributionReason: "owned_user_navigation",
    };
  }
  if (context?.attribution === "confirmed")
    return { ...evaluation, attributionReason: "confirmed_source" };
  if (evaluation.decision === NEW_TAB_DECISIONS.ALLOW)
    return { ...evaluation, attributionReason: "existing_allow_policy" };
  const hasAdEvidence =
    evaluation.targetLikelyAd ||
    evaluation.promotionalIntent ||
    evaluation.blacklisted;
  return {
    ...evaluation,
    decision: hasAdEvidence
      ? NEW_TAB_DECISIONS.VERIFY
      : NEW_TAB_DECISIONS.ALLOW,
    reviewSurface: hasAdEvidence ? NEW_TAB_REVIEW_SURFACES.TOAST : null,
    attributionReason: "insufficient_source_evidence",
    mayReplacePage: false,
  };
}
