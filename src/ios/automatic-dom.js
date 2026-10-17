import { isKnownAdUrl, IOS_AD_HOSTS } from "./network-rules.js";
import { decideDomCandidate } from "../dom/decision.js";
export const IOS_BUILTIN_DOM_SELECTORS = Object.freeze([
  "ins.adsbygoogle",
  'iframe[src*="//googleads.g.doubleclick.net/"]',
  '[id^="google_ads_iframe_"]',
  '[data-ad-client^="ca-pub-"]',
]);
export function shouldAutoHideIosBanner(features = {}) {
  if (features.inProtectedArea || !features.visible) return false;
  const media =
    ["img", "iframe", "video"].includes(features.tag) ||
    (features.descendants?.imageCount || 0) +
      (features.descendants?.iframeCount || 0) >
      0;
  if (!media) return false;
  const knownHost = (host) =>
    IOS_AD_HOSTS.some((ad) => host === ad || host.endsWith("." + ad));
  if (
    isKnownAdUrl(features.src) ||
    isKnownAdUrl(features.href) ||
    [
      ...(features.descendants?.hrefHosts || []),
      ...(features.descendants?.srcHosts || []),
    ].some(knownHost)
  )
    return true;
  const explicit =
    /(^|[\s_-])(?:ad|ads|adv|advert|advertisement|sponsored)(?=$|[\s_-])/i.test(
      (features.id || "") + " " + (features.className || ""),
    );
  if (
    !explicit ||
    !(features.linkExternal || features.descendants?.externalLinkCount > 0) ||
    !features.signals ||
    !features.rect
  )
    return false;
  return decideDomCandidate(features).confidence >= 0.9;
}
