export const NEW_TAB_DECISIONS = Object.freeze({
  ALLOW: "allow",
  CLOSE: "close",
  VERIFY: "verify",
});

export const NEW_TAB_REVIEW_SURFACES = Object.freeze({
  FULL_PAGE: "full_page",
  TOAST: "toast",
  CLOSE: "close",
});

export function decideNewTabNavigation({
  sameSite = false,
  trustedInitiator = false,
  trustedTarget = false,
  whitelisted = false,
  blacklisted = false,
  trustedPath = false,
  promotionalIntent = false,
  targetLikelyAd = false,
} = {}) {
  if (blacklisted) return NEW_TAB_DECISIONS.CLOSE;
  if (
    sameSite ||
    trustedInitiator ||
    (trustedTarget && !promotionalIntent && !targetLikelyAd) ||
    whitelisted ||
    (!promotionalIntent && !targetLikelyAd && trustedPath)
  )
    return NEW_TAB_DECISIONS.ALLOW;
  return NEW_TAB_DECISIONS.VERIFY;
}

export function shouldKeepTrackingNewTab({ sameSite = false } = {}) {
  return sameSite;
}

export function chooseNewTabReviewSurface({
  promotionalIntent = false,
  targetLikelyAd = false,
  intentReasons = [],
  targetReasons = [],
} = {}) {
  const reasons = new Set([...intentReasons, ...targetReasons]);
  const strongTracking = reasons.has("strong_tracking_parameter");
  const strongPrefilledSearch = reasons.has("prefilled_search_navigation");
  const corroboratingSignal =
    reasons.has("multiple_campaign_parameters") ||
    reasons.has("promotional_element_or_destination");
  if (strongPrefilledSearch || (strongTracking && corroboratingSignal)) {
    return NEW_TAB_REVIEW_SURFACES.CLOSE;
  }
  return promotionalIntent || targetLikelyAd
    ? NEW_TAB_REVIEW_SURFACES.FULL_PAGE
    : NEW_TAB_REVIEW_SURFACES.TOAST;
}
