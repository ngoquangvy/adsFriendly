import { createDecision, DECISION_ACTIONS } from "../shared/decision.js";

export function decideDomCandidate(features) {
  const reasons = [];
  let score = 0;

  if (!features.visible) {
    return createDecision(DECISION_ACTIONS.OBSERVE, {
      confidence: 0,
      reasons: ["not_visible"],
    });
  }

  if (features.inProtectedArea) {
    return createDecision(DECISION_ACTIONS.OBSERVE, {
      confidence: 0.1,
      reasons: ["protected_area"],
    });
  }

  if (features.signals.classHasAdToken) {
    score += 0.35;
    reasons.push("class_ad_token");
  }
  if (features.signals.idHasAdToken) {
    score += 0.35;
    reasons.push("id_ad_token");
  }
  if (features.signals.idLooksAdSlot) {
    score += 0.24;
    reasons.push("ad_slot_id");
  }
  if (features.signals.classHasAdToken && features.signals.idHasAdToken) {
    score += 0.08;
    reasons.push("class_and_id_ad_tokens");
  }
  if (features.signals.hrefLooksAdLike) {
    score += 0.25;
    reasons.push("ad_like_href");
  }
  if (features.signals.hrefHostLooksCommercial) {
    score += 0.18;
    reasons.push("commercial_or_tracking_host");
  }
  if (features.linkExternal) {
    score += 0.12;
    reasons.push("external_link");
  }
  if (
    features.linkExternal &&
    (features.signals.classHasAdToken || features.signals.idHasAdToken)
  ) {
    score += 0.2;
    reasons.push("external_link_with_ad_token");
  }
  if (features.fixedOrSticky) {
    score += 0.15;
    reasons.push("fixed_or_sticky");
  }
  if (features.rect.areaRatio > 0.08 && features.rect.areaRatio < 0.45) {
    score += 0.12;
    reasons.push("banner_sized_area");
  }
  if (features.compactBannerShape) {
    score += 0.12;
    reasons.push("compact_banner_shape");
  }
  if (features.billboardShape) {
    score += 0.12;
    reasons.push("billboard_ad_shape");
  }
  if (features.tallSidebarShape) {
    score += 0.12;
    reasons.push("sidebar_ad_shape");
  }
  if (
    features.tag === "iframe" &&
    (features.signals.idHasAdToken || features.signals.idLooksAdSlot)
  ) {
    score += 0.18;
    reasons.push("iframe_with_ad_slot_id");
  }
  if (features.signals.srcIsImageCdn && features.signals.classHasAdToken) {
    score += 0.12;
    reasons.push("cdn_image_with_ad_class");
  }
  if (features.descendants.externalAdLinkCount > 0) {
    score += 0.22;
    reasons.push("descendant_external_ad_link");
  }
  if (
    features.descendants.imageCdnCount > 0 &&
    (features.signals.classHasAdToken || features.signals.idHasAdToken)
  ) {
    score += 0.12;
    reasons.push("descendant_cdn_media_with_ad_token");
  }
  if (
    features.descendants.iframeCount > 0 &&
    (features.signals.classHasAdToken || features.signals.idHasAdToken)
  ) {
    score += 0.12;
    reasons.push("descendant_iframe_with_ad_token");
  }
  if (features.inNavigationArea && features.navAdLinkRatio >= 0.8) {
    score += 0.2;
    reasons.push("ad_heavy_navigation_area");
  }
  if (features.textLength > 500) {
    score -= 0.25;
    reasons.push("large_text_content");
  }

  const confidence = Math.max(0, Math.min(1, score));
  if (confidence >= 0.78) {
    return createDecision(DECISION_ACTIONS.BLOCK, { confidence, reasons });
  }
  if (confidence >= 0.55) {
    return createDecision(DECISION_ACTIONS.TOAST, { confidence, reasons });
  }
  return createDecision(DECISION_ACTIONS.OBSERVE, { confidence, reasons });
}
