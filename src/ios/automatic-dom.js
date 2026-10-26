import { isKnownAdUrl, IOS_AD_HOSTS } from "./network-rules.js";
const AD_MARKER =
  /(^|[\s_-])(?:ad|ads|adv|advert|advertisement|sponsored)(?=$|[\s_-])/i;
// Candidate discovery is deliberately wider than classification. A matching
// selector alone is never permission to hide an element.
export const IOS_BANNER_CANDIDATE_SELECTOR = [
  '[class*="banner" i]',
  '[id*="banner" i]',
  ...["ad", "ads", "adv", "advert", "advertisement", "sponsored"].flatMap(
    (token) => [
      `[class~="${token}" i]`,
      `[class^="${token}-" i]`,
      `[class*="-${token}-" i]`,
      `[class$="-${token}" i]`,
      `[class*="_${token}" i]`,
      `[id="${token}" i]`,
      `[id^="${token}-" i]`,
      `[id^="${token}_" i]`,
      `[id*="-${token}-" i]`,
      `[id$="-${token}" i]`,
      `[id*="_${token}" i]`,
    ],
  ),
].join(",");
export const IOS_BUILTIN_DOM_SELECTORS = Object.freeze([
  "ins.adsbygoogle",
  'iframe[src*="//googleads.g.doubleclick.net/"]',
  '[id^="google_ads_iframe_"]',
  '[data-ad-client^="ca-pub-"]',
]);
export function iosBuiltinDomSelectors(hostname = "") {
  // Verified publisher placements, not a blanket block on Googleusercontent:
  // these images share a CDN with legitimate posters/community images.
  const host = String(hostname).toLowerCase().replace(/\.$/, "");
  const publisher =
    host === "animevietsub.sale" || host.endsWith(".animevietsub.sale");
  return IOS_BUILTIN_DOM_SELECTORS.concat(
    publisher
      ? [
          // Hide the verified ad owner, not just its creative. Otherwise the
          // full-screen backdrop/close control remains above the real page.
          'div[id^="_preload-ads-"]',
          ".header-ads-pc > a",
          ".pc_catfix_adv > a",
          'a[href*="/animevietsubapp-topbanner"]',
          'a[href*="/animevietsubapp-right-banner"]',
          'a[href*="/animevietsubapp-catfish"]',
          'a[href*="/cpd/animevietsubcatfish"]',
          'a[href*="/animevietsubapp-popup"]',
        ]
      : [],
  );
}
function isConfirmedIosBanner(features = {}) {
  if (features.inProtectedArea || !features.visible) return false;
  const media =
    ["img", "iframe", "video"].includes(features.tag) ||
    (features.descendants?.imageCount || 0) +
      (features.descendants?.iframeCount || 0) >
      0;
  if (!media) return false;
  if (
    (features.textLength || 0) > 240 ||
    (features.descendants?.linkCount || 0) > 12
  )
    return false;
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
  const explicit = AD_MARKER.test(
    (features.id || "") + " " + (features.className || ""),
  );
  // Prefer a creative over its whole wrapper: inherited slot evidence lets
  // Keep on one image preserve that image without preserving every sibling ad.
  const inheritedSlot =
    ["a", "img", "iframe"].includes(features.tag) &&
    features.ancestry
      ?.slice(0, 3)
      .some(
        (parent) =>
          !["html", "body", "main", "header", "nav", "form"].includes(
            parent.tag,
          ) &&
          parent.childCount <= 12 &&
          AD_MARKER.test((parent.id || "") + " " + (parent.className || "")),
      );
  const creative = features.rect?.width >= 120 && features.rect?.height >= 24;
  const linkedOrFramed =
    features.linkExternal ||
    features.descendants?.externalLinkCount > 0 ||
    features.tag === "iframe" ||
    features.descendants?.iframeCount > 0;
  return !!((explicit || inheritedSlot) && creative && linkedOrFramed);
}

// The site policy is independent of the review UI budget. Candidate discovery
// supplies evidence; Block must not silently become Default a second time here.
export function shouldAutoHideIosBanner(features = {}, context = {}) {
  const policy = context.policy || "default";
  const evidence = context.evidence || {};
  if (
    context.enabled === false ||
    policy === "allow" ||
    features.inProtectedArea ||
    evidence.protectedContent ||
    ["html", "head", "body", "main", "nav", "header", "form"].includes(
      features.tag,
    )
  )
    return false;
  if (evidence.invisibleOverlay)
    return policy === "block" && evidence.candidate === true;
  if (!features.visible) return false;
  if (policy === "block")
    return evidence.candidate === true || isConfirmedIosBanner(features);
  // Default keeps known-resource filtering and only auto-removes uncertain
  // placements when independent close-control and advertising signals agree.
  const media =
    ["img", "iframe", "video"].includes(features.tag) ||
    (features.descendants?.imageCount || 0) +
      (features.descendants?.iframeCount || 0) >
      0;
  const known =
    [features.src, features.href].some(isKnownAdUrl) ||
    [
      ...(features.descendants?.hrefHosts || []),
      ...(features.descendants?.srcHosts || []),
    ].some((host) =>
      IOS_AD_HOSTS.some((ad) => host === ad || host.endsWith("." + ad)),
    );
  return !!(
    (media && known && (features.textLength || 0) <= 240) ||
    (evidence.closeButton &&
      (evidence.directAdLink || (evidence.adContent && evidence.geometry)))
  );
}
