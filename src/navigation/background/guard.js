import { parseUrl, sameHostnameOrSubdomain } from "../../shared/url.js";
import { runtimeState } from "../../background/state.js";
import { getDynamicTrustWindow } from "../../background/reputation.js";
import { logBlockedNavigation } from "../../background/logs.js";
import { getTrustedPath, syncTrustedPath } from "./trusted-paths.js";
import { getDomPatterns } from "../../shared/pattern-store.js";
import { CAPABILITIES } from "../../runtime/feature-catalog.js";

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
  chrome.webNavigation.onCreatedNavigationTarget.addListener((details) =>
    evaluateNewTab({
      sourceTabId: details.sourceTabId,
      tabId: details.tabId,
      url: details.url,
    }),
  );

  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    lastActiveTabId = tabs?.[0]?.id || null;
  });

  chrome.tabs.onActivated.addListener((activeInfo) => {
    lastActiveTabId = activeInfo.tabId;
  });

  chrome.tabs.onCreated.addListener((tab) => {
    const sourceTabId =
      tab.openerTabId ||
      (hasRecentLinkIntentFromActiveTab(1500) ? lastActiveTabId : null);
    if (!sourceTabId || !tab.id) return;
    pendingTabs.set(tab.id, {
      sourceTabId,
      createdAt: Date.now(),
      hasRealOpener: !!tab.openerTabId,
    });
    setTimeout(
      () => pendingTabs.delete(tab.id),
      tab.openerTabId ? 10000 : 2000,
    );
    if (tab.url && !isBlankUrl(tab.url)) {
      evaluateNewTab({ sourceTabId, tabId: tab.id, url: tab.url });
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url || isBlankUrl(changeInfo.url)) return;
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
  });

  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0 || isBlankUrl(details.url)) return;
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
  });
}

function hasRecentLinkIntentFromActiveTab(windowMs) {
  return (
    !!runtimeState.lastTrustedClick.intentUrl &&
    runtimeState.lastTrustedClick.tabId === lastActiveTabId &&
    Date.now() - runtimeState.lastTrustedClick.timestamp < windowMs
  );
}

function isExpiredFallbackPending(pending) {
  return !pending.hasRealOpener && Date.now() - pending.createdAt > 2000;
}

async function evaluateNewTab({ sourceTabId, tabId, url }) {
  if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_GUARD)) return;
  if (!sourceTabId || !tabId || !url || isBlankUrl(url)) return;
  if (handledTabs.has(tabId)) return;

  try {
    const { whitelist = [], blacklist = [] } =
      await chrome.storage.local.get(["whitelist", "blacklist"]);
    const sourceTab = await chrome.tabs.get(sourceTabId);
    if (!sourceTab?.url?.startsWith("http")) return;
    const sourceUrl = new URL(sourceTab.url);
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
      await logBlockedNavigation(url, sourceUrl.hostname);
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
  await logBlockedNavigation(url, source);
  await chrome.tabs.update(tabId, {
    url: chrome.runtime.getURL(
      `ui/blocked.html?url=${encodeURIComponent(url)}&source=${encodeURIComponent(source)}`,
    ),
  });
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
