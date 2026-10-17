import { isKnownAdUrl, IOS_AD_HOSTS } from "./network-rules.js";
const AD_MARKER =
  /(^|[\s_-])(?:ad|ads|adv|advert|advertisement|sponsored)(?=$|[\s_-])/i;
// Candidate discovery is deliberately wider than classification. A matching
// selector alone is never permission to hide an element.
export const IOS_BANNER_CANDIDATE_SELECTOR = [
  '[class*="banner" i]',
  '[id*="banner" i]',
  ...["ad", "ads", "adv", "advert", "sponsored"].flatMap((token) => [
    `[class~="${token}" i]`,
    `[class^="${token}-" i]`,
    `[class*="-${token}-" i]`,
    `[class$="-${token}" i]`,
    `[class*="_${token}" i]`,
    `[id^="${token}-" i]`,
    `[id^="${token}_" i]`,
  ]),
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
export function shouldAutoHideIosBanner(features = {}) {
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
