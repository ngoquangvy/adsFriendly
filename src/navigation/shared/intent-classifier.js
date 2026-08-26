import { parseUrl, sameHostnameOrSubdomain } from "../../shared/url.js";
import { getPrefilledSearchNavigation } from "./search-navigation.js";

const STRONG_TRACKING_KEYS = new Set([
  "adid",
  "aff_id",
  "affiliate",
  "bannerid",
  "clickid",
  "gclid",
  "pop_id",
  "popunder",
  "zoneid",
]);
const PROMOTIONAL_TOKEN_RE =
  /(^|[^a-z0-9])(?:ad|ads|advert|banner|casino|hitclub|promo|sponsor|bet)([^a-z0-9]|$)/i;
const PROMOTIONAL_SEARCH_DESTINATION_RE =
  /(?:^|\s)(?:https?:\/\/)?(?:www\.)?[a-z0-9-]{4,}\.(?:bet|casino|click|live|top|vip|win|xyz)(?:\b|\/)/i;
const STRONG_CAMPAIGN_VALUE_RE =
  /(^|[^a-z0-9])(?:popunder|popup|interstitial)([^a-z0-9]|$)/i;
const AD_NETWORK_VALUE_RE =
  /(^|[^a-z0-9])(?:clickadu|popads|propellerads|adsterra)([^a-z0-9]|$)/i;

export function classifyNavigationIntent({
  intentUrl,
  sourceUrl,
  evidence = "",
} = {}) {
  const intent = parseUrl(intentUrl);
  const source = parseUrl(sourceUrl);
  const promotionalEvidence = PROMOTIONAL_TOKEN_RE.test(evidence);
  if (!intent || !/^https?:$/.test(intent.protocol)) {
    return {
      likelyAd: promotionalEvidence,
      reasons: promotionalEvidence
        ? ["promotional_element_or_destination"]
        : [],
    };
  }

  const external =
    !source ||
    !(
      sameHostnameOrSubdomain(intent.hostname, source.hostname) ||
      sameHostnameOrSubdomain(source.hostname, intent.hostname)
    );
  if (!external) return { likelyAd: false, reasons: [] };

  const keys = [...intent.searchParams.keys()].map((key) => key.toLowerCase());
  const campaignValues = [...intent.searchParams.entries()]
    .filter(([key]) => key.toLowerCase().startsWith("utm_"))
    .map(([, value]) => value);
  const strongCampaignValue = campaignValues.some((value) =>
    STRONG_CAMPAIGN_VALUE_RE.test(value),
  );
  const adNetworkValue = campaignValues.some((value) =>
    AD_NETWORK_VALUE_RE.test(value),
  );
  const strongTracking =
    keys.some((key) => STRONG_TRACKING_KEYS.has(key)) || strongCampaignValue;
  const marketingCount = keys.filter((key) => key.startsWith("utm_")).length;
  const tokenEvidence = `${intent.hostname} ${intent.pathname} ${evidence}`;
  const promotionalToken = PROMOTIONAL_TOKEN_RE.test(tokenEvidence);
  const searchNavigation = getPrefilledSearchNavigation(intent);
  const prefilledSearchNavigation = Boolean(searchNavigation);
  const promotionalSearchDestination = Boolean(
    searchNavigation?.embeddedHost &&
    PROMOTIONAL_SEARCH_DESTINATION_RE.test(searchNavigation.embeddedHost),
  );
  const reasons = [];
  if (strongTracking) reasons.push("strong_tracking_parameter");
  if (marketingCount >= 2) reasons.push("multiple_campaign_parameters");
  if (promotionalToken || adNetworkValue)
    reasons.push("promotional_element_or_destination");
  if (prefilledSearchNavigation) reasons.push("prefilled_search_navigation");
  if (promotionalSearchDestination)
    reasons.push("promotional_search_destination");

  return {
    likelyAd: reasons.length > 0,
    reasons,
  };
}
