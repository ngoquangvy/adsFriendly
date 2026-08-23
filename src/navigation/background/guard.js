import { parseUrl, sameHostnameOrSubdomain } from "../../shared/url.js";
import { runtimeState } from "../../background/state.js";
import { getDynamicTrustWindow } from "../../background/reputation.js";
import { logBlockedNavigation } from "../../background/logs.js";
import { getTrustedPath, syncTrustedPath } from "./trusted-paths.js";
import { getDomPatterns } from "../../shared/pattern-store.js";
import { CAPABILITIES } from "../../runtime/feature-catalog.js";
import {
  REVERSE_POPUNDER_WINDOW_MS,
  isReversePopunderSequence,
  isSelfCloneNavigation,
} from "./reverse-popunder.js";

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
let lastActiveTabId = null;
let navigationPolicy = null;

export function isSuspiciousURL(url, patterns = []) {
  const u = parseUrl(url);
  if (!u) return false;
  const suspiciousKeys = [
    "clickid",
    "pop_id",
    "popunder",
    "bannerid",
    "zoneid",
  ];
  if (
    [...u.searchParams.keys()].some((key) =>
      suspiciousKeys.includes(key.toLowerCase()),
    )
  )
    return true;
  return patterns.some(
    (pattern) =>
      pattern?.type === "domain" &&
      sameHostnameOrSubdomain(
        u.hostname,
        String(pattern.value || "")
          .replace(/^\|\|/, "")
          .replace(/\^$/, "")
          .toLowerCase(),
      ),
  );
}
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

  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    lastActiveTabId = tabs?.[0]?.id || null;
  });

  const onActivated = (activeInfo) => {
    lastActiveTabId = activeInfo.tabId;
  };

  const onCreated = (tab) => {
    const sourceTabId =
      tab.openerTabId ||
      (hasRecentUserGestureFromActiveTab(1500) ? lastActiveTabId : null);
    if (!sourceTabId || !tab.id) return;
    pendingTabs.set(tab.id, {
      sourceTabId,
      createdAt: Date.now(),
      hasRealOpener: !!tab.openerTabId,
    });
    trackReverseCandidate({
      sourceTabId,
      cloneTabId: tab.id,
      cloneUrl: tab.url,
    }).catch(logReversePopunderError);
    setTimeout(
      () => pendingTabs.delete(tab.id),
      tab.openerTabId ? 10000 : 2000,
    );
    if (tab.url && !isBlankUrl(tab.url)) {
      evaluateNewTab({ sourceTabId, tabId: tab.id, url: tab.url });
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
  chrome.tabs.onActivated.addListener(onActivated);
  chrome.tabs.onCreated.addListener(onCreated);
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.webNavigation.onCommitted.addListener(onCommitted);

  return () => {
    chrome.webNavigation.onCreatedNavigationTarget.removeListener(
      onCreatedNavigationTarget,
    );
    chrome.tabs.onActivated.removeListener(onActivated);
    chrome.tabs.onCreated.removeListener(onCreated);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.webNavigation.onCommitted.removeListener(onCommitted);
    pendingTabs.clear();
    reverseCandidatesBySource.clear();
    reverseCandidatesByClone.clear();
    navigationPolicy = null;
  };
}

function hasRecentUserGestureFromActiveTab(windowMs) {
  return (
    !!runtimeState.lastTrustedClick.sourceUrl &&
    runtimeState.lastTrustedClick.tabId === lastActiveTabId &&
    Date.now() - runtimeState.lastTrustedClick.timestamp < windowMs
  );
}

function isExpiredFallbackPending(pending) {
  return !pending.hasRealOpener && Date.now() - pending.createdAt > 2000;
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
    hasMatchingIntent(
      candidate.sourceTabId,
      redirected.hostname,
      trustWindow,
    )
  )
    return true;

  const path = await getTrustedPath(original.hostname, redirected.hostname);
  return !!path && (path.isManual || path.visits >= 3);
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

  try {
    const { whitelist = [], blacklist = [] } =
      await chrome.storage.local.get(["whitelist", "blacklist"]);
    const sourceTab = await chrome.tabs.get(sourceTabId);
    const capturedSourceUrl =
      reverseCandidatesBySource.get(sourceTabId)?.originalUrl || sourceTab?.url;
    if (!capturedSourceUrl?.startsWith("http")) return;
    const sourceUrl = new URL(capturedSourceUrl);
    const targetUrl = new URL(url);
    const targetDomain = targetUrl.hostname;
    if (
      sameHostnameOrSubdomain(sourceUrl.hostname, targetDomain) ||
      sameHostnameOrSubdomain(targetDomain, sourceUrl.hostname)
    )
      return;

    if (isTrustedInitiator(sourceUrl.hostname)) return;
    if (isTrustedTarget(targetDomain)) return;
    if (whitelist.includes(targetDomain)) return;
    if (isBlacklistedTarget(targetDomain, blacklist)) {
      await logBlockedNavigationIfAllowed(url, sourceUrl.hostname);
      return closeTabQuietly(tabId);
    }

    const trustWindow = await getDynamicTrustWindow(sourceUrl.hostname);
    let intentMatched = hasMatchingIntent(
      sourceTabId,
      targetDomain,
      trustWindow,
    );
    const path = await getTrustedPath(sourceUrl.hostname, targetDomain);
    if (path && (path.isManual || path.visits >= 3)) return;

    if (intentMatched) {
      syncTrustedPath(sourceUrl.hostname, targetDomain);
      return;
    }

    const suspicious = isSuspiciousURL(url, await getDomPatterns());
    if (suspicious) {
      await delay(180);
      intentMatched = hasMatchingIntent(sourceTabId, targetDomain, trustWindow);
      if (intentMatched) {
        syncTrustedPath(sourceUrl.hostname, targetDomain);
        return;
      }
      return redirectToBlockedPage(tabId, url, sourceUrl.hostname);
    }

    // Cross-site navigation without a strong blocking signal is ambiguous.
    // Keep the user's tab open instead of quarantining it by default.
  } catch (err) {
    console.error("Error evaluating navigation:", err);
  } finally {
    pendingTabs.delete(tabId);
    handledTabs.set(tabId, Date.now());
    setTimeout(() => handledTabs.delete(tabId), 15000);
  }
}

function hasMatchingIntent(sourceTabId, targetDomain, trustWindow) {
  const click = runtimeState.lastTrustedClick;
  if (click.tabId !== sourceTabId) return false;
  const intent = parseUrl(click.intentUrl);
  const timeSinceClick = Date.now() - click.timestamp;
  return (
    timeSinceClick >= 0 &&
    timeSinceClick < trustWindow &&
    !!intent &&
    (sameHostnameOrSubdomain(targetDomain, intent.hostname) ||
      sameHostnameOrSubdomain(intent.hostname, targetDomain))
  );
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
