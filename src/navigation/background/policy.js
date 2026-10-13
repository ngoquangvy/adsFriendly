import { parseUrl, sameHostnameOrSubdomain } from "../../shared/url.js";
import { getTrustedPath } from "./trusted-paths.js";
import { PREFILLED_SEARCH_TRUST_TARGET } from "../shared/search-navigation.js";
import { classifyNavigationIntent } from "../shared/intent-classifier.js";
import {
  NEW_TAB_DECISIONS,
  chooseNewTabReviewSurface,
  decideNewTabNavigation,
} from "./new-tab-policy.js";
import { constrainNavigationEnforcement } from "./enforcement-policy.js";

const TRUSTED_INITIATORS = [
  "google.com",
  "bing.com",
  "duckduckgo.com",
  "yahoo.com",
  "search.yahoo.com",
  "github.com",
  "microsoft.com",
  "login.microsoftonline.com",
  "live.com",
  "apple.com",
  "appleid.apple.com",
  "facebook.com",
  "accounts.facebook.com",
  "cloudflare.com",
  "challenges.cloudflare.com",
];

const TRUSTED_TARGETS = [
  ...TRUSTED_INITIATORS,
  "paypal.com",
  "stripe.com",
  "checkout.stripe.com",
  "pay.google.com",
  "payments.google.com",
  "shop.app",
  "klarna.com",
  "adyen.com",
  "authorize.net",
];

export async function evaluateNavigationPolicy(
  {
    sourceUrl: sourceValue,
    targetUrl: targetValue,
    allowMatchingIntent = false,
    allowTrustedInitiator = true,
    context,
  },
  { storage = chrome.storage.local, readTrustedPath = getTrustedPath } = {},
) {
  const sourceUrl = new URL(sourceValue);
  const targetUrl = new URL(targetValue);
  const targetDomain = targetUrl.hostname;
  const sameSite =
    sameHostnameOrSubdomain(sourceUrl.hostname, targetDomain) ||
    sameHostnameOrSubdomain(targetDomain, sourceUrl.hostname);
  const targetClassification = classifyNavigationIntent({
    intentUrl: targetUrl.href,
    sourceUrl: sourceUrl.href,
  });
  const prefilledSearch = targetClassification.reasons.includes(
    "prefilled_search_navigation",
  );
  const trustTarget = prefilledSearch
    ? PREFILLED_SEARCH_TRUST_TARGET
    : targetDomain;
  const [{ whitelist = [], blacklist = [] }, path] = await Promise.all([
    storage.get(["whitelist", "blacklist"]),
    readTrustedPath(sourceUrl.hostname, trustTarget),
  ]);
  const intentClassification = classifyCapturedIntent(context);
  const promotionalIntent = intentClassification.likelyAd;
  const allowedSearch = prefilledSearch && path?.isManual === true;
  const matchingIntent =
    allowMatchingIntent && hasMatchingIntent(context, targetDomain);
  const blacklisted = isBlacklistedTarget(targetDomain, blacklist);
  const decision = allowedSearch
    ? NEW_TAB_DECISIONS.ALLOW
    : decideNewTabNavigation({
        sameSite,
        trustedInitiator:
          allowTrustedInitiator && isTrustedInitiator(sourceUrl.hostname),
        trustedTarget: isTrustedTarget(targetDomain),
        whitelisted: whitelist.includes(targetDomain),
        blacklisted,
        trustedPath:
          matchingIntent || !!path?.isManual || (path?.visits || 0) >= 3,
        promotionalIntent,
        targetLikelyAd: targetClassification.likelyAd,
      });
  const reviewSurface =
    decision === NEW_TAB_DECISIONS.VERIFY
      ? chooseNewTabReviewSurface({
          promotionalIntent,
          targetLikelyAd: targetClassification.likelyAd,
          intentReasons: intentClassification.reasons,
          targetReasons: targetClassification.reasons,
        })
      : null;
  const evaluation = constrainNavigationEnforcement(context, {
    sourceUrl,
    targetUrl,
    targetDomain,
    sameSite,
    trustTarget,
    allowedSearch,
    decision,
    reviewSurface,
    blacklisted,
    promotionalIntent,
    targetLikelyAd: targetClassification.likelyAd,
    reasons: [
      ...new Set([
        ...targetClassification.reasons,
        ...intentClassification.reasons,
      ]),
    ],
  });
  if (
    evaluation.decision !== NEW_TAB_DECISIONS.ALLOW &&
    promotionalIntent &&
    !targetClassification.likelyAd &&
    !blacklisted &&
    context?.intentAssociation !== "matched_link"
  ) {
    return {
      ...evaluation,
      decision: NEW_TAB_DECISIONS.VERIFY,
      reviewSurface: "toast",
      mayReplacePage: false,
      attributionReason: "intent_not_linked_to_destination",
    };
  }
  return evaluation;
}

function hasMatchingIntent(context, targetDomain) {
  const click = context?.intent;
  if (!click || context.intentAssociation !== "matched_link") return false;
  const intent = parseUrl(click.intentUrl);
  if (classifyCapturedIntent(context).likelyAd) return false;
  return (
    !!intent &&
    (sameHostnameOrSubdomain(targetDomain, intent.hostname) ||
      sameHostnameOrSubdomain(intent.hostname, targetDomain))
  );
}

function classifyCapturedIntent(context) {
  const click = context?.intent;
  if (
    !click ||
    !["matched_link", "frame_temporal"].includes(context.intentAssociation)
  )
    return { likelyAd: false, reasons: [] };
  const classification = classifyNavigationIntent({
    intentUrl: click.intentUrl,
    sourceUrl: click.sourceUrl,
    evidence: click.intentKind === "promotional" ? "promo" : "",
  });
  const reasons = [
    ...new Set([...(click.intentReasons || []), ...classification.reasons]),
  ];
  return {
    likelyAd: click.intentKind === "promotional" || classification.likelyAd,
    reasons,
  };
}

function isTrustedInitiator(hostname) {
  return hostMatchesAny(hostname, TRUSTED_INITIATORS) || isGoogleHost(hostname);
}

function isTrustedTarget(hostname) {
  return hostMatchesAny(hostname, TRUSTED_TARGETS) || isGoogleHost(hostname);
}

function isBlacklistedTarget(hostname, blacklist = []) {
  const normalized = hostname.toLowerCase();
  return blacklist.some((entry) => {
    const value = String(entry || "")
      .replace(/^\|\|/, "")
      .replace(/\^$/, "")
      .toLowerCase();
    return normalized === value || normalized.endsWith(`.${value}`);
  });
}

function hostMatchesAny(hostname, domains) {
  const normalized = hostname.toLowerCase();
  return domains.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

function isGoogleHost(hostname) {
  return /^(.+\.)?google\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(
    hostname.toLowerCase(),
  );
}
