import {
  BLOCKING_STRATEGIES,
  captureInlineVisibility,
  isHiddenByAdsFriendly,
  restoreInlineVisibility,
} from "./actions.js";
import { decideDomCandidate } from "./decision.js";
import {
  buildDomSelector,
  extractDomFeatures,
  getSmallestSafeDomTarget,
} from "./features.js";
import { showDomCandidateToast } from "./toast.js";
import { CAPABILITIES } from "../runtime/feature-catalog.js";
import { getResponsiveLayout } from "./layout-context.js";
import {
  createElementException,
  elementExceptionKey,
  matchesElementException,
} from "./element-exceptions.js";

const observed = new WeakSet();
const allowedSelectors = new Set();
let activePolicy = null;
let scanIntervalId = null;
let bodyObserver = null;
let elementExceptions = [];
let elementExceptionsReady = false;
let storageListener = null;
const DOM_CANDIDATE_SELECTOR = [
  "img",
  "iframe",
  "a[href]",
  '[id*="ad" i]',
  '[class*="ad" i]',
  '[id*="adv" i]',
  '[class*="adv" i]',
  '[id*="banner" i]',
  '[class*="banner" i]',
  '[id*="promo" i]',
  '[class*="promo" i]',
  '[id*="sponsor" i]',
  '[class*="sponsor" i]',
].join(",");

export function startDomCandidateCollector(policy) {
  activePolicy = policy;
  elementExceptionsReady = false;
  loadElementExceptions().finally(() => {
    elementExceptionsReady = true;
    scanDomCandidates();
  });
  storageListener = (changes, areaName) => {
    if (areaName !== "local" || !changes.userElementExceptions) return;
    elementExceptions = exceptionsForCurrentSite(
      changes.userElementExceptions.newValue,
    );
  };
  chrome.storage.onChanged.addListener(storageListener);
  scanIntervalId = setInterval(scanDomCandidates, 2500);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () =>
      setTimeout(scanDomCandidates, 400),
    );
  } else {
    setTimeout(scanDomCandidates, 400);
  }

  const startObserver = () => {
    if (!activePolicy) return;
    if (!document.body) {
      setTimeout(startObserver, 100);
      return;
    }
    bodyObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) scanNode(node);
        }
      }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  };
  startObserver();

  return () => {
    if (scanIntervalId) clearInterval(scanIntervalId);
    scanIntervalId = null;
    bodyObserver?.disconnect();
    bodyObserver = null;
    if (storageListener)
      chrome.storage.onChanged.removeListener(storageListener);
    storageListener = null;
    elementExceptions = [];
    elementExceptionsReady = false;
    activePolicy = null;
  };
}

function scanDomCandidates() {
  if (!elementExceptionsReady || !activePolicy?.can(CAPABILITIES.DOM_OBSERVE))
    return;
  scanNode(document);
}

function scanNode(root) {
  if (root.matches?.(DOM_CANDIDATE_SELECTOR)) evaluateElement(root);
  const candidates = root.querySelectorAll
    ? root.querySelectorAll(DOM_CANDIDATE_SELECTOR)
    : [];
  candidates.forEach(evaluateElement);
}

function evaluateElement(element) {
  if (
    observed.has(element) ||
    element.id?.includes("adsfriendly") ||
    isHiddenByAdsFriendly(element)
  )
    return;

  const features = extractDomFeatures(element);
  const decision = decideDomCandidate(features);
  if (decision.action === "observe") return;

  observed.add(element);
  const target = getSmallestSafeDomTarget(element, features);
  if (isHiddenByAdsFriendly(target)) return;
  const selector = buildDomSelector(target);
  if (selector && allowedSelectors.has(selector)) return;
  const layout = getResponsiveLayout();
  if (
    elementExceptions.some((rule) =>
      matchesElementException(rule, { selector, features, layout }),
    )
  )
    return;

  const candidate = { element, target, selector, features, decision, layout };
  if (decision.action === "block") {
    if (activePolicy?.can(CAPABILITIES.DOM_AUTO_HIDE)) {
      hideCandidate(candidate, "heuristic_block");
    } else if (activePolicy?.can(CAPABILITIES.DOM_SUGGEST)) {
      showCandidate(candidate);
    }
    return;
  }
  if (!activePolicy?.can(CAPABILITIES.DOM_SUGGEST)) return;
  showCandidate(candidate);
}

function showCandidate(candidate) {
  showDomCandidateToast(candidate, {
    onHide: (item) => hideCandidate(item, "user_hide"),
    onAllow: rememberNotAdCandidate,
    onUndoAllow: forgetNotAdCandidate,
    onAllowConfirmed: confirmNotAdCandidate,
    isSuppressed: isCandidateSuppressed,
    onShow: restoreCandidate,
  });
}

function isCandidateSuppressed(candidate) {
  return elementExceptions.some((rule) =>
    matchesElementException(rule, {
      selector: candidate.selector,
      features: candidate.features,
      layout: candidate.layout || getResponsiveLayout(),
    }),
  );
}

async function hideCandidate(candidate, outcome) {
  candidate.previousInlineVisibility ||= captureInlineVisibility(
    candidate.target,
  );
  BLOCKING_STRATEGIES.STEALTH(candidate.target);
  if (activePolicy?.can(CAPABILITIES.LEARNING_FEEDBACK))
    recordDomSample(candidate, outcome, "ad");
  if (outcome === "user_hide") {
    if (!candidate.selector)
      throw new Error("This element does not have a reusable selector.");
    await persistCustomRule(candidate, outcome);
  }
  try {
    await chrome.runtime.sendMessage({
      type: "REPORT_AD_DENSITY",
      hostname: location.hostname,
      count: 1,
    });
  } catch {}
}

async function rememberNotAdCandidate(candidate) {
  const rule = createElementException(candidate, {
    layout: candidate.layout || getResponsiveLayout(),
  });
  const response = await chrome.runtime.sendMessage({
    type: "UPSERT_ELEMENT_EXCEPTIONS",
    hostname: location.hostname,
    rules: [rule],
  });
  assertSaved(response);
  candidate.elementException = rule;
  elementExceptions = [
    ...elementExceptions.filter(
      (existing) => elementExceptionKey(existing) !== elementExceptionKey(rule),
    ),
    rule,
  ];
}

async function forgetNotAdCandidate(candidate) {
  const rule = candidate.elementException;
  if (!rule) throw new Error("The saved element exception is unavailable.");
  const response = await chrome.runtime.sendMessage({
    type: "REMOVE_ELEMENT_EXCEPTIONS",
    hostname: location.hostname,
    ids: [elementExceptionKey(rule)],
  });
  assertSaved(response);
  elementExceptions = elementExceptions.filter(
    (existing) => elementExceptionKey(existing) !== elementExceptionKey(rule),
  );
}

function confirmNotAdCandidate(candidate) {
  if (activePolicy?.can(CAPABILITIES.LEARNING_FEEDBACK))
    recordDomSample(candidate, "user_allow", "content");
}

async function restoreCandidate(candidate) {
  if (candidate.selector) {
    await removeCustomRule(candidate.selector);
    allowedSelectors.add(candidate.selector);
  }
  restoreInlineVisibility(candidate.target, candidate.previousInlineVisibility);
  if (activePolicy?.can(CAPABILITIES.LEARNING_FEEDBACK))
    recordDomSample(candidate, "user_show", "content");
}

async function persistCustomRule(candidate, outcome) {
  const rule = {
    selector: candidate.selector,
    fingerprint: {
      tag: candidate.features.tag,
      id: candidate.features.id || null,
      className: candidate.features.className || null,
      alt: candidate.features.alt || null,
      title: candidate.features.title || null,
      linkDomain: candidate.features.hrefHost || null,
      srcHost: candidate.features.srcHost || null,
      idTokens: candidate.features.idTokens,
      classTokens: candidate.features.classTokens,
    },
    timestamp: Date.now(),
    timesZapped: 1,
    confidence: candidate.decision.confidence,
    source: outcome,
    layout: candidate.layout || getResponsiveLayout(),
  };
  const response = await chrome.runtime.sendMessage({
    type: "UPSERT_CUSTOM_RULES",
    hostname: location.hostname,
    rules: [rule],
  });
  assertSaved(response);
  await chrome.runtime.sendMessage({ type: "SYNC_LEARNING" });
}

async function loadElementExceptions() {
  try {
    const { userElementExceptions = {} } = await chrome.storage.local.get(
      "userElementExceptions",
    );
    elementExceptions = exceptionsForCurrentSite(userElementExceptions);
  } catch {
    elementExceptions = [];
  }
}

function exceptionsForCurrentSite(value) {
  const rules = value?.[location.hostname];
  return Array.isArray(rules) ? rules : [];
}

async function removeCustomRule(selector) {
  const response = await chrome.runtime.sendMessage({
    type: "RESTORE_CUSTOM_RULES",
    hostname: location.hostname,
    selectors: [selector],
  });
  assertSaved(response);
  await chrome.runtime.sendMessage({ type: "SYNC_LEARNING" });
}

function assertSaved(response) {
  if (response?.status !== "saved")
    throw new Error(response?.error || "AdsFriendly could not save settings.");
}

async function recordDomSample(candidate, outcome, label) {
  try {
    const sample = {
      schema_version: "dataset.v1",
      sample_id: randomId(),
      unit: "dom_element",
      label,
      label_source: outcome,
      label_strength: outcome.startsWith("user_") ? "strong" : "weak",
      ad_type: "banner",
      site: {
        hostname: location.hostname,
        url: location.href.split("#")[0],
      },
      timestamp: Date.now(),
      context: {
        selector: candidate.selector,
        action: candidate.decision.action,
        confidence: candidate.decision.confidence,
      },
      evidence: {
        reasons: candidate.decision.reasons,
        features: candidate.features,
      },
      feedback: outcome.startsWith("user_")
        ? {
            user_action: outcome,
            surface: "dom_candidate_toast",
            correction: ["user_allow", "user_show"].includes(outcome)
              ? "false_positive"
              : null,
          }
        : null,
      action: ["user_allow", "user_show"].includes(outcome) ? "allow" : "hide",
      outcome,
    };
    await chrome.runtime.sendMessage({ type: "RECORD_DOM_SAMPLE", sample });
    await chrome.runtime.sendMessage({
      type: "RECORD_TELEMETRY",
      event: sample,
    });
  } catch {}
}

function randomId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
