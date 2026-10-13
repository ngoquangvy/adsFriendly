import { logBlockedNavigation } from "../../background/logs.js";
import { CAPABILITIES } from "../../runtime/feature-catalog.js";
import {
  NEW_TAB_DECISIONS,
  NEW_TAB_REVIEW_SURFACES,
  isBrowserUiNewTab,
  isWebNavigationTarget,
  isExplicitAddressBarCommitForUrl,
  shouldEvaluateCommittedNavigation,
  shouldKeepTrackingNewTab,
} from "./new-tab-policy.js";
import {
  REVERSE_POPUNDER_WINDOW_MS,
  isReversePopunderReviewSequence,
  isReversePopunderSequence,
  isSelfCloneNavigation,
} from "./reverse-popunder.js";
import {
  NAVIGATION_SEQUENCES,
  createNavigationEnforcementPlan,
} from "./navigation-sequences.js";
import { navigationDiagnostics } from "./diagnostics.js";
import {
  ATTRIBUTION_EVIDENCE,
  navigationAttribution,
  navigationAttributionFacts,
} from "./attribution.js";
import { managedNavigationTabs } from "./managed-tabs.js";
import { evaluateNavigationPolicy } from "./policy.js";
import { userNavigationTracker } from "./user-navigation.js";

const pendingTabs = new Map();
const handledTabs = new Map();
const evaluatingTabs = new Map();
const reverseCandidatesBySource = new Map();
const reverseCandidatesByClone = new Map();
const committedUrlsByTab = new Map();
const committedNavigationsByTab = new Map();
const pendingReviewToasts = new Map();
const blockedNoticesBySource = new Map();
const browserUiTabs = new Map();
const explicitNavigationEpochs = new Map();
let navigationPolicy = null;
let guardGeneration = 0;

export function registerNavigationGuard(policy) {
  const generation = ++guardGeneration;
  navigationPolicy = policy;
  chrome.tabs
    .query({})
    .then((tabs) => {
      if (generation !== guardGeneration) return;
      for (const tab of tabs) rememberCommittedUrl(tab.id, tab.url);
    })
    .catch(() => {});
  const onCreatedNavigationTarget = (details) => {
    if (
      deferManagedTab({ id: details.tabId, url: details.url }, () =>
        onCreatedNavigationTarget(details),
      )
    )
      return;
    if (!isBlankUrl(details.url) && !isWebNavigationTarget(details.url)) return;
    if (
      browserUiTabs.has(details.tabId) ||
      isExplicitAddressBarCommitForUrl(
        details.url,
        committedNavigationsByTab.get(details.tabId),
      )
    )
      return;
    recordNavigationTrace({
      type: "navigation_target_created",
      sourceTabId: details.sourceTabId,
      tabId: details.tabId,
      url: details.url,
      role: "web_created_target",
    });
    const context = registerPendingTab(
      { id: details.tabId, url: details.url },
      details.sourceTabId,
      ATTRIBUTION_EVIDENCE.WEB_TARGET,
      details.sourceFrameId,
    );
    if (!context) return;
    evaluateNewTab({
      sourceTabId: details.sourceTabId,
      tabId: details.tabId,
      url: details.url,
      context,
    });
  };

  const registerPendingTab = (
    tab,
    sourceTabId,
    evidence,
    sourceFrameId = null,
  ) => {
    if (!Number.isInteger(tab?.id) || !Number.isInteger(sourceTabId)) return;
    const destination = tab.pendingUrl || tab.url;
    if (
      destination &&
      !isBlankUrl(destination) &&
      !isWebNavigationTarget(destination)
    )
      return;
    const initialUrl = tab.pendingUrl || tab.url;
    if (
      isExplicitAddressBarCommitForUrl(
        initialUrl,
        committedNavigationsByTab.get(tab.id),
      )
    )
      return;
    const context = navigationAttribution.link({
      targetTabId: tab.id,
      sourceTabId,
      sourceFrameId,
      targetUrl: initialUrl,
      sourceUrl: committedUrlsByTab.get(sourceTabId),
      evidence,
    });
    if (!context || context.origin !== "website") return;
    if (context.targetUrl !== initialUrl) return context;
    recordNavigationTrace({
      type: "candidate_linked",
      tabId: tab.id,
      sourceTabId: context.sourceTabId,
      openerTabId: tab.openerTabId,
      url: tab.pendingUrl || tab.url,
      role: evidence,
      ...navigationAttributionFacts(context),
    });
    rememberCommittedUrl(tab.id, tab.pendingUrl || tab.url);
    pendingTabs.set(tab.id, context);
    trackReverseCandidate({
      sourceTabId: context.sourceTabId,
      cloneTabId: tab.id,
      cloneUrl: tab.pendingUrl || tab.url,
      context,
    }).catch(logReversePopunderError);
    setTimeout(() => {
      if (pendingTabs.get(tab.id) === context) pendingTabs.delete(tab.id);
    }, 10000);
    if (initialUrl && !isBlankUrl(initialUrl)) {
      // tabs.onCreated can observe the tab after its address-bar navigation
      // has already committed. Never evaluate that URL without its transition
      // metadata; onCommitted will handle it if it has not arrived yet.
      const committed = committedNavigationsByTab.get(tab.id);
      if (isExplicitAddressBarCommitForUrl(initialUrl, committed)) {
        pendingTabs.delete(tab.id);
        return;
      }
      if (committed?.url === initialUrl) {
        evaluateNewTab({
          sourceTabId: context.sourceTabId,
          tabId: tab.id,
          url: initialUrl,
          context,
        });
      }
    }
    return context;
  };

  const markManagedTab = (tab) => {
    const receipt = managedNavigationTabs.owns(
      tab.id,
      tab.pendingUrl || tab.url,
    );
    if (!receipt) return false;
    cancelTabAttribution(tab.id);
    recordNavigationTrace({
      type: "candidate_linked",
      tabId: tab.id,
      url: receipt.url,
      navigationSchema: "navigation-context.v1",
      navigationId: receipt.navigationId,
      origin: "extension",
      attribution: "confirmed",
      attributionEvidence: ["registered_extension_action"],
      reason: receipt.reason,
    });
    return true;
  };
  const deferManagedTab = (tab, retry) => {
    if (markManagedTab(tab)) return true;
    if (!managedNavigationTabs.hasPending(tab)) return false;
    managedNavigationTabs
      .waitForCreatedTab(tab)
      .then((owned) => {
        if (!navigationPolicy || generation !== guardGeneration) return;
        if (owned) markManagedTab(tab);
        else retry();
      })
      .catch(() => {});
    return true;
  };

  const onCreated = (tab) => {
    rememberCommittedUrl(tab.id, tab.pendingUrl || tab.url);
    recordNavigationTrace({
      type: "tab_created",
      tabId: tab.id,
      openerTabId: tab.openerTabId,
      url: tab.pendingUrl || tab.url,
      role: Number.isInteger(tab.openerTabId) ? "has_opener" : "no_opener",
    });
    if (deferManagedTab(tab, () => onCreated(tab))) return;
    if (
      isBrowserUiNewTab({ ...tab, openerTabId: null }) &&
      Number.isInteger(tab.id)
    ) {
      browserUiTabs.set(tab.id, Date.now());
      setTimeout(() => browserUiTabs.delete(tab.id), 2 * 60 * 1000);
      return;
    }
    // Browser new-tab UI is handled before non-web filtering or opener inference.
    const initialUrl = tab.pendingUrl || tab.url;
    if (
      initialUrl &&
      !isBlankUrl(initialUrl) &&
      !isWebNavigationTarget(initialUrl)
    )
      return;
    const recentIntent = navigationAttribution.latestIntent();
    const sourceTabId = Number.isInteger(tab.openerTabId)
      ? tab.openerTabId
      : recentIntent?.tabId;
    if (Number.isInteger(sourceTabId)) {
      registerPendingTab(
        tab,
        sourceTabId,
        Number.isInteger(tab.openerTabId)
          ? ATTRIBUTION_EVIDENCE.OPENER
          : ATTRIBUTION_EVIDENCE.RECENT_CLICK,
      );
      return;
    }
    if (!Number.isInteger(tab.id)) return;
    // Some popunder scripts suppress opener metadata and create the tab before
    // the frame's TRUSTED_CLICK message reaches the service worker.
    setTimeout(async () => {
      if (
        !navigationPolicy ||
        generation !== guardGeneration ||
        pendingTabs.has(tab.id) ||
        handledTabs.has(tab.id) ||
        browserUiTabs.has(tab.id)
      )
        return;
      const delayedSourceTabId = navigationAttribution.latestIntent()?.tabId;
      if (!Number.isInteger(delayedSourceTabId)) return;
      try {
        const currentTab = await chrome.tabs.get(tab.id);
        if (deferManagedTab(currentTab, () => onCreated(currentTab))) return;
        registerPendingTab(
          currentTab,
          delayedSourceTabId,
          ATTRIBUTION_EVIDENCE.RECENT_CLICK,
        );
      } catch {}
    }, 300);
  };

  const onCommitted = (details) => {
    if (details.frameId !== 0 || isBlankUrl(details.url)) return;
    if (markManagedTab({ id: details.tabId, url: details.url })) return;
    if (!isWebNavigationTarget(details.url)) {
      // Cancel any in-flight website decision without trusting future web URLs.
      cancelTabAttribution(details.tabId);
      return;
    }
    const wasBrowserUiTab = browserUiTabs.has(details.tabId);
    const explicitAddressBarCommit =
      !shouldEvaluateCommittedNavigation(details);
    committedNavigationsByTab.set(details.tabId, {
      url: details.url,
      transitionType: details.transitionType,
      transitionQualifiers: details.transitionQualifiers || [],
    });
    if (explicitAddressBarCommit) {
      if (
        pendingTabs.has(details.tabId) ||
        evaluatingTabs.has(details.tabId) ||
        reverseCandidatesByClone.has(details.tabId) ||
        reverseCandidatesBySource.has(details.tabId)
      ) {
        triggerNavigationDiagnosticCapture(
          "address_bar_commit_superseded_pending_ad_candidate",
        );
      }
    }
    recordNavigationTrace({
      type: "navigation_committed",
      tabId: details.tabId,
      url: details.url,
      transitionType: details.transitionType,
      transitionQualifiers: details.transitionQualifiers,
      role: wasBrowserUiTab
        ? "browser_ui_tab"
        : explicitAddressBarCommit
          ? "explicit_user_navigation"
          : "tracked_or_unknown",
    });
    const userRedirect = userNavigationTracker.continueRedirect(details);
    if (wasBrowserUiTab || explicitAddressBarCommit || userRedirect) {
      cancelTabAttribution(details.tabId);
      if (!userRedirect)
        userNavigationTracker.begin(details.tabId, details.url);
      browserUiTabs.delete(details.tabId);
      pendingTabs.delete(details.tabId);
      rememberCommittedUrl(details.tabId, details.url);
      return;
    }
    const previousContext = pendingTabs.get(details.tabId);
    if (previousContext) {
      const updated = navigationAttribution.retarget(
        previousContext,
        details.url,
      );
      if (updated) {
        pendingTabs.set(details.tabId, updated);
        const clone = reverseCandidatesByClone.get(details.tabId);
        if (clone) clone.context = updated;
      }
    }
    observeReverseNavigation(details.tabId, details.url);
    rememberCommittedUrl(details.tabId, details.url);
    const pending = pendingTabs.get(details.tabId);
    if (!pending) return;
    if (!navigationAttribution.isCurrent(pending)) {
      pendingTabs.delete(details.tabId);
      return;
    }
    evaluateNewTab({
      sourceTabId: pending.sourceTabId,
      tabId: details.tabId,
      url: details.url,
      context: pending,
    });
  };

  const onRemoved = (tabId) => {
    recordNavigationTrace({
      type: "tab_removed",
      tabId,
      url: committedUrlsByTab.get(tabId),
      sourceTabId: pendingTabs.get(tabId)?.sourceTabId,
      role: "no_extension_removal_cause_recorded",
    });
    committedUrlsByTab.delete(tabId);
    committedNavigationsByTab.delete(tabId);
    pendingReviewToasts.delete(tabId);
    browserUiTabs.delete(tabId);
    explicitNavigationEpochs.delete(tabId);
    pendingTabs.delete(tabId);
    handledTabs.delete(tabId);
    navigationAttribution.removeTab(tabId);
    managedNavigationTabs.removeTab(tabId);
    userNavigationTracker.removeTab(tabId);
    for (const candidate of new Set([
      reverseCandidatesBySource.get(tabId),
      reverseCandidatesByClone.get(tabId),
    ]))
      if (candidate) cleanupReverseCandidate(candidate);
  };

  chrome.webNavigation.onCreatedNavigationTarget.addListener(
    onCreatedNavigationTarget,
  );
  chrome.tabs.onCreated.addListener(onCreated);
  chrome.webNavigation.onCommitted.addListener(onCommitted);
  chrome.tabs.onRemoved.addListener(onRemoved);

  return () => {
    if (generation !== guardGeneration) return;
    guardGeneration++;
    chrome.webNavigation.onCreatedNavigationTarget.removeListener(
      onCreatedNavigationTarget,
    );
    chrome.tabs.onCreated.removeListener(onCreated);
    chrome.webNavigation.onCommitted.removeListener(onCommitted);
    chrome.tabs.onRemoved.removeListener(onRemoved);
    pendingTabs.clear();
    evaluatingTabs.clear();
    reverseCandidatesBySource.clear();
    reverseCandidatesByClone.clear();
    committedUrlsByTab.clear();
    committedNavigationsByTab.clear();
    pendingReviewToasts.clear();
    blockedNoticesBySource.clear();
    handledTabs.clear();
    navigationAttribution.clear();
    managedNavigationTabs.clear();
    userNavigationTracker.clear();
    browserUiTabs.clear();
    explicitNavigationEpochs.clear();
    navigationPolicy = null;
  };
}

function cancelTabAttribution(tabId) {
  explicitNavigationEpochs.set(
    tabId,
    (explicitNavigationEpochs.get(tabId) || 0) + 1,
  );
  navigationAttribution.invalidate(tabId);
  pendingTabs.delete(tabId);
  pendingReviewToasts.delete(tabId);
  for (const candidate of new Set([
    reverseCandidatesBySource.get(tabId),
    reverseCandidatesByClone.get(tabId),
  ]))
    if (candidate) cleanupReverseCandidate(candidate);
}

async function trackReverseCandidate({
  sourceTabId,
  cloneTabId,
  cloneUrl,
  context,
}) {
  if (
    !navigationPolicy?.can(CAPABILITIES.NAVIGATION_REVERSE_POPUNDER) ||
    !sourceTabId ||
    !cloneTabId
  )
    return;
  if (!navigationAttribution.isCurrent(context)) return;
  const previousClone = reverseCandidatesByClone.get(cloneTabId);
  if (previousClone && previousClone.sourceTabId !== sourceTabId)
    cleanupReverseCandidate(previousClone);

  let candidate = reverseCandidatesBySource.get(sourceTabId);
  if (candidate && candidate.cloneTabId !== cloneTabId) {
    cleanupReverseCandidate(candidate);
    candidate = null;
  }
  if (!candidate) {
    candidate = {
      sourceTabId,
      cloneTabId,
      originalUrl:
        context.sourceUrl ||
        context.intent?.sourceUrl ||
        committedUrlsByTab.get(sourceTabId),
      context,
      cloneUrl: null,
      redirectedUrl: null,
      createdAt: Date.now(),
      handling: false,
      reviewTimer: null,
      revision: 0,
    };
    reverseCandidatesBySource.set(sourceTabId, candidate);
    reverseCandidatesByClone.set(cloneTabId, candidate);
    setTimeout(
      () => cleanupReverseCandidate(candidate),
      REVERSE_POPUNDER_WINDOW_MS + 500,
    );
  }
  candidate.context = context;

  if (!candidate.originalUrl) {
    try {
      const sourceTab = await chrome.tabs.get(sourceTabId);
      if (sourceTab?.url?.startsWith("http")) {
        candidate.originalUrl = sourceTab.url;
      }
    } catch {}
  }
  if (!isCurrentReverseCandidate(candidate)) return;
  if (cloneUrl && !isBlankUrl(cloneUrl)) candidate.cloneUrl = cloneUrl;
  maybeHandleReversePopunder(candidate).catch(logReversePopunderError);
}

function observeReverseNavigation(tabId, url) {
  const cloneCandidate = reverseCandidatesByClone.get(tabId);
  if (cloneCandidate) {
    if (cloneCandidate.cloneUrl !== url) cloneCandidate.revision++;
    cloneCandidate.cloneUrl = url;
    maybeHandleReversePopunder(cloneCandidate).catch(logReversePopunderError);
  }

  const sourceCandidate = reverseCandidatesBySource.get(tabId);
  if (sourceCandidate) {
    if (sourceCandidate.redirectedUrl !== url) sourceCandidate.revision++;
    sourceCandidate.redirectedUrl = url;
    maybeHandleReversePopunder(sourceCandidate).catch(logReversePopunderError);
  }
}

async function maybeHandleReversePopunder(candidate) {
  if (
    !isCurrentReverseCandidate(candidate) ||
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
  ) {
    scheduleReverseRedirectReview(candidate);
    return;
  }

  // A temporal guess needs an actual same-page clone + source redirect before
  // it can become confirmed. Ordinary unrelated tabs cannot produce this proof.
  if (candidate.context.attribution !== "confirmed") {
    const context = navigationAttribution.link({
      targetTabId: candidate.cloneTabId,
      sourceTabId: candidate.sourceTabId,
      sourceFrameId: candidate.context.sourceFrameId,
      sourceUrl: candidate.originalUrl,
      targetUrl: candidate.cloneUrl,
      evidence: ATTRIBUTION_EVIDENCE.REVERSE_SEQUENCE,
    });
    if (!context || context.origin !== "website") return;
    candidate.context = context;
    pendingTabs.set(candidate.cloneTabId, context);
    recordNavigationTrace({
      type: "candidate_linked",
      tabId: candidate.cloneTabId,
      sourceTabId: candidate.sourceTabId,
      role: "reverse_sequence_confirmed",
      ...navigationAttributionFacts(context),
    });
  }

  candidate.handling = true;
  const expectedRevision = candidate.revision;
  const expectedContext = candidate.context;
  const isCurrent = () =>
    isCurrentReverseCandidate(candidate) &&
    candidate.revision === expectedRevision &&
    navigationAttribution.isCurrent(expectedContext);
  if (await isAllowedReverseRedirect(candidate)) {
    cleanupReverseCandidate(candidate);
    return;
  }
  if (!isCurrent()) return;

  const sourceHost = new URL(candidate.originalUrl).hostname;
  try {
    const sourceTab = await chrome.tabs.get(candidate.sourceTabId);
    if (
      !isCurrent() ||
      (sourceTab.pendingUrl || sourceTab.url) !== candidate.redirectedUrl
    )
      return;
  } catch {
    return;
  }

  let enforcementPlan = createNavigationEnforcementPlan({
    sequence: NAVIGATION_SEQUENCES.ORIGINAL_TAB_WAS_REDIRECTED,
    originalTabId: candidate.sourceTabId,
    openedTabId: candidate.cloneTabId,
  });
  let applied = false;
  try {
    const cloneTab = await chrome.tabs.get(candidate.cloneTabId);
    if (!isCurrent()) return;
    if (
      !cloneTab?.url ||
      !isSelfCloneNavigation(candidate.originalUrl, cloneTab.url)
    )
      throw new Error("clone gone");
    await chrome.tabs.update(enforcementPlan.survivingTabId, { active: true });
    if (!isCurrent()) return;
    recordNavigationTrace({
      type: "enforcement_requested",
      tabId: enforcementPlan.closeTabId,
      sourceTabId: enforcementPlan.notifyTabId,
      targetUrl: candidate.redirectedUrl,
      action: "close_tab",
      role: "reverse_popunder",
      ...navigationAttributionFacts(expectedContext),
    });
    await chrome.tabs.remove(enforcementPlan.closeTabId);
    applied = true;
  } catch {
    if (!isCurrent()) return;
    enforcementPlan = createNavigationEnforcementPlan({
      sequence: NAVIGATION_SEQUENCES.ORIGINAL_TAB_WAS_REDIRECTED,
      originalTabId: candidate.sourceTabId,
      openedTabId: candidate.cloneTabId,
      restoreOriginal: true,
    });
    try {
      await chrome.tabs.update(enforcementPlan.restoreTabId, {
        url: candidate.originalUrl,
      });
      applied = true;
    } catch {}
  } finally {
    if (applied) {
      recordNavigationTrace({
        type: "enforcement_completed",
        tabId: enforcementPlan.closeTabId ?? enforcementPlan.restoreTabId,
        sourceTabId: enforcementPlan.notifyTabId,
        action:
          enforcementPlan.restoreTabId === null
            ? "close_tab"
            : "restore_original",
        role: "reverse_popunder",
        ...navigationAttributionFacts(expectedContext),
      });
      void logBlockedNavigationIfAllowed(
        candidate.redirectedUrl,
        sourceHost,
        expectedContext,
      );
      pendingTabs.delete(candidate.cloneTabId);
      await showBlockedNavigationToast({
        sourceTabId: enforcementPlan.notifyTabId,
        url: candidate.redirectedUrl,
        source: sourceHost,
        target: new URL(candidate.redirectedUrl).hostname,
      });
      cleanupReverseCandidate(candidate);
    }
  }
}

function scheduleReverseRedirectReview(candidate) {
  if (candidate.reviewTimer) return;
  const elapsedMs = Date.now() - candidate.createdAt;
  if (
    !isReversePopunderReviewSequence({
      originalUrl: candidate.originalUrl,
      cloneUrl: candidate.cloneUrl,
      redirectedUrl: candidate.redirectedUrl,
      elapsedMs,
    })
  )
    return;
  candidate.reviewTimer = setTimeout(() => {
    candidate.reviewTimer = null;
    reviewReverseRedirect(candidate).catch(logReversePopunderError);
  }, 400);
}

async function reviewReverseRedirect(candidate) {
  if (candidate.handling || !isCurrentReverseCandidate(candidate)) return;
  const elapsedMs = Date.now() - candidate.createdAt;
  if (
    isReversePopunderSequence({
      originalUrl: candidate.originalUrl,
      cloneUrl: candidate.cloneUrl,
      redirectedUrl: candidate.redirectedUrl,
      elapsedMs,
    })
  ) {
    await maybeHandleReversePopunder(candidate);
    return;
  }
  if (
    !isReversePopunderReviewSequence({
      originalUrl: candidate.originalUrl,
      cloneUrl: candidate.cloneUrl,
      redirectedUrl: candidate.redirectedUrl,
      elapsedMs,
    })
  )
    return;

  candidate.handling = true;
  const revision = candidate.revision;
  const context = candidate.context;
  const evaluation = await evaluateNavigationPolicy({
    sourceUrl: candidate.originalUrl,
    targetUrl: candidate.redirectedUrl,
    sourceTabId: candidate.sourceTabId,
    allowMatchingIntent: true,
    allowTrustedInitiator: false,
    context,
  });
  if (
    !isCurrentReverseCandidate(candidate) ||
    candidate.revision !== revision ||
    !navigationAttribution.isCurrent(context)
  )
    return;
  if (evaluation.decision !== NEW_TAB_DECISIONS.ALLOW) {
    await showNavigationReviewToast({
      tabId: candidate.sourceTabId,
      url: candidate.redirectedUrl,
      source: evaluation.sourceUrl.hostname,
      target: evaluation.targetDomain,
      context,
    });
  }
  cleanupReverseCandidate(candidate);
}

async function isAllowedReverseRedirect(candidate) {
  const evaluation = await evaluateNavigationPolicy({
    sourceUrl: candidate.originalUrl,
    targetUrl: candidate.redirectedUrl,
    sourceTabId: candidate.sourceTabId,
    allowMatchingIntent: true,
    allowTrustedInitiator: false,
    context: candidate.context,
  });
  if (evaluation.allowedSearch) {
    await showAllowedSearchToast({
      tabId: candidate.sourceTabId,
      url: evaluation.targetUrl.href,
      source: evaluation.sourceUrl.hostname,
      target: evaluation.trustTarget,
    });
  }
  return evaluation.decision === NEW_TAB_DECISIONS.ALLOW;
}

function isCurrentReverseCandidate(candidate) {
  return (
    reverseCandidatesBySource.get(candidate.sourceTabId) === candidate &&
    reverseCandidatesByClone.get(candidate.cloneTabId) === candidate &&
    navigationAttribution.isCurrent(candidate.context)
  );
}

function cleanupReverseCandidate(candidate) {
  if (candidate.reviewTimer) clearTimeout(candidate.reviewTimer);
  candidate.reviewTimer = null;
  if (reverseCandidatesBySource.get(candidate.sourceTabId) === candidate) {
    reverseCandidatesBySource.delete(candidate.sourceTabId);
  }
  if (reverseCandidatesByClone.get(candidate.cloneTabId) === candidate) {
    reverseCandidatesByClone.delete(candidate.cloneTabId);
  }
}

function rememberCommittedUrl(tabId, url) {
  if (Number.isInteger(tabId) && url?.startsWith("http")) {
    committedUrlsByTab.set(tabId, url);
  }
}

function logReversePopunderError(error) {
  console.error("Reverse pop-under guard failed:", error);
}

async function evaluateNewTab({ sourceTabId, tabId, url, context }) {
  if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_GUARD)) return;
  if (!sourceTabId || !tabId || !url || isBlankUrl(url)) return;
  if (!isWebNavigationTarget(url)) return;
  if (context?.targetUrl !== url) return;
  if (
    !navigationAttribution.isCurrent(context) ||
    handledTabs.get(tabId) === context
  )
    return;
  if (evaluatingTabs.get(tabId) === context) return;
  evaluatingTabs.set(tabId, context);
  const evaluationEpoch = explicitNavigationEpochs.get(tabId) || 0;
  const isCurrentEvaluation = () =>
    navigationPolicy &&
    navigationAttribution.isCurrent(context) &&
    (explicitNavigationEpochs.get(tabId) || 0) === evaluationEpoch;
  const canEnforce = async () => {
    if (!isCurrentEvaluation()) return false;
    try {
      const tab = await chrome.tabs.get(tabId);
      return isCurrentEvaluation() && (tab.pendingUrl || tab.url) === url;
    } catch {
      return false;
    }
  };

  let shouldFinalize = false;
  try {
    const sourceTab = await chrome.tabs.get(sourceTabId);
    const capturedSourceUrl =
      context.sourceUrl || context.intent?.sourceUrl || sourceTab?.url;
    if (!capturedSourceUrl?.startsWith("http")) return;
    const evaluation = await evaluateNavigationPolicy({
      sourceUrl: capturedSourceUrl,
      targetUrl: url,
      sourceTabId,
      context,
    });
    // A user may type a destination into an ad-created blank tab while the
    // original popup decision is still waiting on storage/intent signals.
    // An explicit address-bar commit supersedes that stale decision.
    if (!isCurrentEvaluation()) return;
    const { sourceUrl, targetDomain, decision, reviewSurface } = evaluation;
    recordNavigationTrace({
      type: "policy_decided",
      tabId,
      sourceTabId,
      sourceUrl: sourceUrl.href,
      targetUrl: url,
      decision,
      reviewSurface,
      reasons: evaluation.reasons,
      reason: evaluation.attributionReason,
      ...navigationAttributionFacts(context),
    });
    // A same-site landing page may only be an intermediate redirect. Keep the
    // tab associated with its source until it leaves the site or expires.
    if (shouldKeepTrackingNewTab({ sameSite: evaluation.sameSite })) return;

    if (evaluation.allowedSearch) {
      shouldFinalize = true;
      return showAllowedSearchToast({
        tabId,
        url,
        source: sourceUrl.hostname,
        target: evaluation.trustTarget,
      });
    }

    if (decision === NEW_TAB_DECISIONS.ALLOW) {
      shouldFinalize = true;
      return;
    }
    shouldFinalize = true;
    if (
      decision === NEW_TAB_DECISIONS.CLOSE ||
      reviewSurface === NEW_TAB_REVIEW_SURFACES.CLOSE
    ) {
      const enforcementPlan = createNavigationEnforcementPlan({
        sequence: NAVIGATION_SEQUENCES.OPENED_TAB_IS_TARGET,
        originalTabId: sourceTabId,
        openedTabId: tabId,
      });
      if (!(await canEnforce())) return;
      recordNavigationTrace({
        type: "enforcement_requested",
        tabId: enforcementPlan.closeTabId,
        sourceTabId: enforcementPlan.notifyTabId,
        sourceUrl: sourceUrl.href,
        targetUrl: url,
        decision,
        action: "close_tab",
        reason:
          decision === NEW_TAB_DECISIONS.CLOSE
            ? "blacklisted_target"
            : "review_policy_close",
        ...navigationAttributionFacts(context),
      });
      const outcome = await closeTabQuietly(
        enforcementPlan.closeTabId,
        canEnforce,
      );
      if (!outcome) return;
      recordNavigationTrace({
        type: "enforcement_completed",
        tabId,
        action: outcome,
        ...navigationAttributionFacts(context),
      });
      void logBlockedNavigationIfAllowed(url, sourceUrl.hostname, context);
      return showBlockedNavigationToast({
        sourceTabId: enforcementPlan.notifyTabId,
        url,
        source: sourceUrl.hostname,
        target: targetDomain,
      });
    }
    if (reviewSurface === NEW_TAB_REVIEW_SURFACES.FULL_PAGE) {
      return redirectToBlockedPage(
        tabId,
        url,
        sourceUrl.hostname,
        canEnforce,
        context,
      );
    }

    if (!(await canEnforce())) return;
    const toastShown = await showNavigationReviewToast({
      tabId,
      url,
      source: sourceUrl.hostname,
      target: targetDomain,
      context,
    });
    if (toastShown || evaluation.mayReplacePage === false) return;
    return redirectToBlockedPage(
      tabId,
      url,
      sourceUrl.hostname,
      canEnforce,
      context,
    );
  } catch (err) {
    console.error("Error evaluating navigation:", err);
  } finally {
    if (evaluatingTabs.get(tabId) === context) evaluatingTabs.delete(tabId);
    if (shouldFinalize && isCurrentEvaluation()) {
      pendingTabs.delete(tabId);
      handledTabs.set(tabId, context);
      setTimeout(() => {
        if (handledTabs.get(tabId) === context) handledTabs.delete(tabId);
      }, 15000);
    }
  }
}

async function showAllowedSearchToast({ tabId, url, source, target }) {
  if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_FEEDBACK)) return false;
  const message = {
    type: "SHOW_ALLOWED_SEARCH_NAVIGATION",
    url,
    source,
    target,
  };
  return queueNavigationToast(tabId, message);
}

export function showAllowedSearchNavigation(details) {
  return showAllowedSearchToast(details);
}

async function showBlockedNavigationToast({
  sourceTabId,
  url,
  source,
  target,
}) {
  if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_FEEDBACK)) return false;
  const now = Date.now();
  const previous = blockedNoticesBySource.get(sourceTabId);
  const count = previous?.expiresAt > now ? previous.count + 1 : 1;
  const notice = {
    count,
    expiresAt: now + 10000,
    message: {
      type: "SHOW_BLOCKED_NAVIGATION",
      count,
      url,
      source,
      target,
    },
  };
  blockedNoticesBySource.set(sourceTabId, notice);
  setTimeout(() => {
    if (blockedNoticesBySource.get(sourceTabId) === notice)
      blockedNoticesBySource.delete(sourceTabId);
  }, 10500);

  // The recipient is always the tab that survives enforcement. Queueing the
  // message also covers the reverse-popunder fallback while its original page
  // is being restored and the content script is starting again.
  return queueNavigationToast(sourceTabId, notice.message);
}

async function showNavigationReviewToast({
  tabId,
  url,
  source,
  target,
  context,
}) {
  if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_FEEDBACK)) return false;
  const message = {
    type: "SHOW_GRAY_NAVIGATION",
    tabId,
    url,
    // Keep/Block feedback must not create trusted workflows for a guessed source.
    source: context?.attribution === "confirmed" ? source : "",
    target,
    navigationAttribution: navigationAttributionFacts(context),
  };
  return queueNavigationToast(tabId, message);
}

async function queueNavigationToast(tabId, message) {
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
  // Do not report success merely because a toast is queued. If the destination
  // never starts its content script, the caller must use its visible fallback
  // instead of silently allowing an unreviewed tab.
  const pending = pendingReviewToasts.get(tabId);
  if (pending?.message === message) pendingReviewToasts.delete(tabId);
  return false;
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function redirectToBlockedPage(
  tabId,
  url,
  source,
  shouldContinue = () => true,
  context,
) {
  if (!(await shouldContinue())) return false;
  recordNavigationTrace({
    type: "enforcement_requested",
    tabId,
    sourceUrl: `https://${source}`,
    targetUrl: url,
    decision: NEW_TAB_DECISIONS.VERIFY,
    action: "redirect_to_blocked_page",
    reason: "review_fallback",
    ...navigationAttributionFacts(context),
  });
  await chrome.tabs.update(tabId, {
    url: chrome.runtime.getURL(
      `ui/blocked.html?url=${encodeURIComponent(url)}&source=${encodeURIComponent(source)}`,
    ),
  });
  recordNavigationTrace({
    type: "enforcement_completed",
    tabId,
    action: "redirect_to_blocked_page",
    ...navigationAttributionFacts(context),
  });
  void logBlockedNavigationIfAllowed(url, source, context);
  return true;
}

async function logBlockedNavigationIfAllowed(url, source, context) {
  if (!navigationPolicy?.can(CAPABILITIES.TELEMETRY_QUEUE)) return;
  try {
    await logBlockedNavigation(
      url,
      source,
      navigationAttributionFacts(context),
    );
  } catch (error) {
    console.debug("Navigation logging unavailable", error);
  }
}

async function closeTabQuietly(tabId, shouldContinue) {
  try {
    await chrome.tabs.remove(tabId);
    return "close_tab";
  } catch {
    if (!(await shouldContinue())) return null;
    try {
      await chrome.tabs.update(tabId, { url: "about:blank" });
      return "blank_tab";
    } catch {
      return null;
    }
  }
}

function recordNavigationTrace(event) {
  navigationDiagnostics.record(event).catch(() => {});
}

function triggerNavigationDiagnosticCapture(reason) {
  navigationDiagnostics
    .startCapture({ durationMs: 10 * 60 * 1000, reason })
    .catch(() => {});
}

function isBlankUrl(url) {
  return (
    !url ||
    url === "about:blank" ||
    url.startsWith("about:") ||
    url.startsWith("chrome:")
  );
}
