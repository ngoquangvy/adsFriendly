import { parseUrl, sameHostnameOrSubdomain } from "../../shared/url.js";
import { runtimeState } from "../../background/state.js";
import { getDynamicTrustWindow } from "../../background/reputation.js";
import { logBlockedNavigation } from "../../background/logs.js";
import { getTrustedPath, syncTrustedPath } from "./trusted-paths.js";
import { CAPABILITIES } from "../../runtime/feature-catalog.js";
import {
  NEW_TAB_DECISIONS,
  NEW_TAB_REVIEW_SURFACES,
  chooseNewTabReviewSurface,
  decideNewTabNavigation,
  shouldKeepTrackingNewTab,
} from "./new-tab-policy.js";
import {
  REVERSE_POPUNDER_WINDOW_MS,
  isReversePopunderSequence,
  isSelfCloneNavigation,
} from "./reverse-popunder.js";
import { classifyNavigationIntent } from "../shared/intent-classifier.js";

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

const pendingTabs = new Map();
const handledTabs = new Map();
const reverseCandidatesBySource = new Map();
const reverseCandidatesByClone = new Map();
const pendingReviewToasts = new Map();
let navigationPolicy = null;

export function registerNavigationGuard(policy) {
  navigationPolicy = policy;
  const onCreatedNavigationTarget = (details) => {
    trackReverseCandidate({
      sourceTabId: details.sourceTabId,
      cloneTabId: details.tabId,
      cloneUrl: details.url,
    }).catch(logReversePopunderError);
    evaluateNewTab({
      sourceTabId: details.sourceTabId,
      tabId: details.tabId,
      url: details.url,
    });
  };

  const onCreated = (tab) => {
    const sourceTabId =
      tab.openerTabId || getRecentUserGestureSourceTabId(2500);
    if (!sourceTabId || !tab.id) return;
    pendingTabs.set(tab.id, {
      sourceTabId,
      createdAt: Date.now(),
      hasRealOpener: !!tab.openerTabId,
    });
    trackReverseCandidate({
      sourceTabId,
      cloneTabId: tab.id,
      cloneUrl: tab.pendingUrl || tab.url,
    }).catch(logReversePopunderError);
    setTimeout(
      () => pendingTabs.delete(tab.id),
      tab.openerTabId ? 10000 : REVERSE_POPUNDER_WINDOW_MS + 500,
    );
    const initialUrl = tab.pendingUrl || tab.url;
    if (initialUrl && !isBlankUrl(initialUrl)) {
      evaluateNewTab({ sourceTabId, tabId: tab.id, url: initialUrl });
    }
  };

  const onUpdated = (tabId, changeInfo) => {
    if (!changeInfo.url || isBlankUrl(changeInfo.url)) return;
    observeReverseNavigation(tabId, changeInfo.url);
    const pending = pendingTabs.get(tabId);
    if (!pending) return;
    if (isExpiredFallbackPending(pending)) {
      pendingTabs.delete(tabId);
      return;
    }
    evaluateNewTab({
      sourceTabId: pending.sourceTabId,
      tabId,
      url: changeInfo.url,
    });
  };

  const onCommitted = (details) => {
    if (details.frameId !== 0 || isBlankUrl(details.url)) return;
    observeReverseNavigation(details.tabId, details.url);
    const pending = pendingTabs.get(details.tabId);
    if (!pending) return;
    if (isExpiredFallbackPending(pending)) {
      pendingTabs.delete(details.tabId);
      return;
    }
    evaluateNewTab({
      sourceTabId: pending.sourceTabId,
      tabId: details.tabId,
      url: details.url,
    });
  };

  chrome.webNavigation.onCreatedNavigationTarget.addListener(
    onCreatedNavigationTarget,
  );
  chrome.tabs.onCreated.addListener(onCreated);
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.webNavigation.onCommitted.addListener(onCommitted);

  return () => {
    chrome.webNavigation.onCreatedNavigationTarget.removeListener(
      onCreatedNavigationTarget,
    );
    chrome.tabs.onCreated.removeListener(onCreated);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.webNavigation.onCommitted.removeListener(onCommitted);
    pendingTabs.clear();
    reverseCandidatesBySource.clear();
    reverseCandidatesByClone.clear();
    pendingReviewToasts.clear();
    navigationPolicy = null;
  };
}

function getRecentUserGestureSourceTabId(windowMs) {
  const click = runtimeState.lastTrustedClick;
  if (
    !click.tabId ||
    !click.sourceUrl ||
    Date.now() - click.timestamp >= windowMs
  )
    return null;
  return click.tabId;
}

function isExpiredFallbackPending(pending) {
  return (
    !pending.hasRealOpener &&
    Date.now() - pending.createdAt > REVERSE_POPUNDER_WINDOW_MS
  );
}

async function trackReverseCandidate({ sourceTabId, cloneTabId, cloneUrl }) {
  if (
    !navigationPolicy?.can(CAPABILITIES.NAVIGATION_REVERSE_POPUNDER) ||
    !sourceTabId ||
    !cloneTabId
  )
    return;

  let candidate = reverseCandidatesBySource.get(sourceTabId);
  if (candidate && candidate.cloneTabId !== cloneTabId) {
    cleanupReverseCandidate(candidate);
    candidate = null;
  }
  if (!candidate) {
    candidate = {
      sourceTabId,
      cloneTabId,
      originalUrl: getRecentSourceUrl(sourceTabId),
      cloneUrl: null,
      redirectedUrl: null,
      createdAt: Date.now(),
      handling: false,
    };
    reverseCandidatesBySource.set(sourceTabId, candidate);
    reverseCandidatesByClone.set(cloneTabId, candidate);
    setTimeout(
      () => cleanupReverseCandidate(candidate),
      REVERSE_POPUNDER_WINDOW_MS + 500,
    );
  }

  if (!candidate.originalUrl) {
    try {
      const sourceTab = await chrome.tabs.get(sourceTabId);
      if (sourceTab?.url?.startsWith("http")) {
        candidate.originalUrl = sourceTab.url;
      }
    } catch {}
  }
  if (cloneUrl && !isBlankUrl(cloneUrl)) candidate.cloneUrl = cloneUrl;
  maybeHandleReversePopunder(candidate).catch(logReversePopunderError);
}

function observeReverseNavigation(tabId, url) {
  const cloneCandidate = reverseCandidatesByClone.get(tabId);
  if (cloneCandidate) {
    cloneCandidate.cloneUrl = url;
    maybeHandleReversePopunder(cloneCandidate).catch(logReversePopunderError);
  }

  const sourceCandidate = reverseCandidatesBySource.get(tabId);
  if (sourceCandidate) {
    sourceCandidate.redirectedUrl = url;
    maybeHandleReversePopunder(sourceCandidate).catch(logReversePopunderError);
  }
}

async function maybeHandleReversePopunder(candidate) {
  if (
    candidate.handling ||
    !candidate.originalUrl ||
    !candidate.cloneUrl ||
    !candidate.redirectedUrl
  )
    return;

  const elapsedMs = Date.now() - candidate.createdAt;
  if (
    !isReversePopunderSequence({
      originalUrl: candidate.originalUrl,
      cloneUrl: candidate.cloneUrl,
      redirectedUrl: candidate.redirectedUrl,
      elapsedMs,
    })
  )
    return;

  candidate.handling = true;
  if (await isAllowedReverseRedirect(candidate)) {
    cleanupReverseCandidate(candidate);
    return;
  }

  const sourceHost = new URL(candidate.originalUrl).hostname;
  await logBlockedNavigationIfAllowed(candidate.redirectedUrl, sourceHost);

  try {
    const cloneTab = await chrome.tabs.get(candidate.cloneTabId);
    if (
      !cloneTab?.url ||
      !isSelfCloneNavigation(candidate.originalUrl, cloneTab.url)
    )
      throw new Error("clone gone");
    await chrome.tabs.update(candidate.cloneTabId, { active: true });
    await chrome.tabs.remove(candidate.sourceTabId);
  } catch {
    try {
      await chrome.tabs.update(candidate.sourceTabId, {
        url: candidate.originalUrl,
      });
    } catch {}
  } finally {
    pendingTabs.delete(candidate.cloneTabId);
    handledTabs.set(candidate.sourceTabId, Date.now());
    cleanupReverseCandidate(candidate);
  }
}

async function isAllowedReverseRedirect(candidate) {
  const original = new URL(candidate.originalUrl);
  const redirected = new URL(candidate.redirectedUrl);
  if (isTrustedTarget(redirected.hostname)) return true;

  const { whitelist = [] } = await chrome.storage.local.get("whitelist");
  if (whitelist.includes(redirected.hostname)) return true;

  const trustWindow = await getDynamicTrustWindow(original.hostname);
  if (
    hasMatchingIntent(candidate.sourceTabId, redirected.hostname, trustWindow)
  )
    return true;

  const path = await getTrustedPath(original.hostname, redirected.hostname);
  return (
    !isPromotionalIntent(candidate.sourceTabId) &&
    !!path &&
    (path.isManual || path.visits >= 3)
  );
}

function getRecentSourceUrl(sourceTabId) {
  const click = runtimeState.lastTrustedClick;
  if (
    click.tabId === sourceTabId &&
    click.sourceUrl?.startsWith("http") &&
    Date.now() - click.timestamp < 2000
  )
    return click.sourceUrl;
  return null;
}

function cleanupReverseCandidate(candidate) {
  if (reverseCandidatesBySource.get(candidate.sourceTabId) === candidate) {
    reverseCandidatesBySource.delete(candidate.sourceTabId);
  }
  if (reverseCandidatesByClone.get(candidate.cloneTabId) === candidate) {
    reverseCandidatesByClone.delete(candidate.cloneTabId);
  }
}

function logReversePopunderError(error) {
  console.error("Reverse pop-under guard failed:", error);
}

async function evaluateNewTab({ sourceTabId, tabId, url }) {
  if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_GUARD)) return;
  if (!sourceTabId || !tabId || !url || isBlankUrl(url)) return;
  if (handledTabs.has(tabId)) return;

  let shouldFinalize = false;
  try {
    const { whitelist = [], blacklist = [] } = await chrome.storage.local.get([
      "whitelist",
      "blacklist",
    ]);
    const sourceTab = await chrome.tabs.get(sourceTabId);
    const capturedSourceUrl =
      reverseCandidatesBySource.get(sourceTabId)?.originalUrl || sourceTab?.url;
    if (!capturedSourceUrl?.startsWith("http")) return;
    const sourceUrl = new URL(capturedSourceUrl);
    const targetUrl = new URL(url);
    const targetDomain = targetUrl.hostname;
    const sameSite =
      sameHostnameOrSubdomain(sourceUrl.hostname, targetDomain) ||
      sameHostnameOrSubdomain(targetDomain, sourceUrl.hostname);
    // A same-site landing page may only be an intermediate redirect. Keep the
    // tab associated with its source until it leaves the site or expires.
    if (shouldKeepTrackingNewTab({ sameSite })) return;

    const trustWindow = await getDynamicTrustWindow(sourceUrl.hostname);
    const path = await getTrustedPath(sourceUrl.hostname, targetDomain);
    // The click message and the content script on a newly opened tab can arrive
    // slightly after the navigation event.
    await delay(180);
    const intentClassification = getRecentIntentClassification(
      sourceTabId,
      trustWindow,
    );
    const promotionalIntent = intentClassification.likelyAd;
    const decision = decideNewTabNavigation({
      sameSite,
      trustedInitiator: isTrustedInitiator(sourceUrl.hostname),
      trustedTarget: isTrustedTarget(targetDomain),
      whitelisted: whitelist.includes(targetDomain),
      blacklisted: isBlacklistedTarget(targetDomain, blacklist),
      trustedPath: !!path && (path.isManual || path.visits >= 3),
      promotionalIntent,
    });

    if (decision === NEW_TAB_DECISIONS.ALLOW) {
      shouldFinalize = true;
      return;
    }
    if (decision === NEW_TAB_DECISIONS.CLOSE) {
      shouldFinalize = true;
      await logBlockedNavigationIfAllowed(url, sourceUrl.hostname);
      return closeTabQuietly(tabId);
    }

    const targetClassification = classifyNavigationIntent({
      intentUrl: url,
      sourceUrl: capturedSourceUrl,
    });
    const reviewSurface = chooseNewTabReviewSurface({
      promotionalIntent,
      targetLikelyAd: targetClassification.likelyAd,
      intentReasons: intentClassification.reasons,
      targetReasons: targetClassification.reasons,
    });
    shouldFinalize = true;
    if (reviewSurface === NEW_TAB_REVIEW_SURFACES.CLOSE) {
      await logBlockedNavigationIfAllowed(url, sourceUrl.hostname);
      return closeTabQuietly(tabId);
    }
    if (reviewSurface === NEW_TAB_REVIEW_SURFACES.FULL_PAGE) {
      return redirectToBlockedPage(tabId, url, sourceUrl.hostname);
    }

    const toastShown = await showNavigationReviewToast({
      tabId,
      url,
      source: sourceUrl.hostname,
      target: targetDomain,
    });
    if (toastShown) return;
    return redirectToBlockedPage(tabId, url, sourceUrl.hostname);
  } catch (err) {
    console.error("Error evaluating navigation:", err);
  } finally {
    if (shouldFinalize) {
      pendingTabs.delete(tabId);
      handledTabs.set(tabId, Date.now());
      setTimeout(() => handledTabs.delete(tabId), 15000);
    }
  }
}

function hasMatchingIntent(sourceTabId, targetDomain, trustWindow) {
  const click = runtimeState.lastTrustedClick;
  if (click.tabId !== sourceTabId) return false;
  const intent = parseUrl(click.intentUrl);
  if (isPromotionalIntent(sourceTabId)) return false;
  const timeSinceClick = Date.now() - click.timestamp;
  return (
    timeSinceClick >= 0 &&
    timeSinceClick < trustWindow &&
    !!intent &&
    (sameHostnameOrSubdomain(targetDomain, intent.hostname) ||
      sameHostnameOrSubdomain(intent.hostname, targetDomain))
  );
}

async function showNavigationReviewToast({ tabId, url, source, target }) {
  if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_FEEDBACK)) return false;
  const message = {
    type: "SHOW_GRAY_NAVIGATION",
    tabId,
    url,
    source,
    target,
  };
  pendingReviewToasts.set(tabId, {
    message,
    expiresAt: Date.now() + 10000,
    delivered: false,
  });
  setTimeout(() => {
    const pending = pendingReviewToasts.get(tabId);
    if (pending?.message === message) pendingReviewToasts.delete(tabId);
  }, 10500);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await deliverPendingNavigationReview(tabId)) {
      pendingReviewToasts.delete(tabId);
      return true;
    }
    if (attempt < 5) await delay(220);
  }
  // The content controller announces readiness after startup. Keeping this
  // queued avoids incorrectly escalating weak evidence to the full block page.
  return pendingReviewToasts.has(tabId);
}

export async function deliverPendingNavigationReview(tabId) {
  const pending = pendingReviewToasts.get(tabId);
  if (!pending) return false;
  if (pending.delivered) return true;
  if (Date.now() >= pending.expiresAt) {
    pendingReviewToasts.delete(tabId);
    return false;
  }
  try {
    await chrome.tabs.sendMessage(tabId, pending.message);
    pending.delivered = true;
    return true;
  } catch {
    return false;
  }
}

function isPromotionalIntent(sourceTabId) {
  return getRecentIntentClassification(sourceTabId).likelyAd;
}

function getRecentIntentClassification(sourceTabId, windowMs = 2500) {
  const click = runtimeState.lastTrustedClick;
  if (
    click.tabId !== sourceTabId ||
    Date.now() - click.timestamp < 0 ||
    Date.now() - click.timestamp >= windowMs
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function redirectToBlockedPage(tabId, url, source) {
  await logBlockedNavigationIfAllowed(url, source);
  await chrome.tabs.update(tabId, {
    url: chrome.runtime.getURL(
      `ui/blocked.html?url=${encodeURIComponent(url)}&source=${encodeURIComponent(source)}`,
    ),
  });
}

async function logBlockedNavigationIfAllowed(url, source) {
  if (navigationPolicy?.can(CAPABILITIES.TELEMETRY_QUEUE)) {
    await logBlockedNavigation(url, source);
  }
}

async function closeTabQuietly(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    try {
      await chrome.tabs.update(tabId, { url: "about:blank" });
    } catch {}
  }
}

function isBlankUrl(url) {
  return (
    !url ||
    url === "about:blank" ||
    url.startsWith("about:") ||
    url.startsWith("chrome:")
  );
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
