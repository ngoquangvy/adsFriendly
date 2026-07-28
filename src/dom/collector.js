import { BLOCKING_STRATEGIES } from "./actions.js";
import { decideDomCandidate } from "./decision.js";
import {
  buildDomSelector,
  extractDomFeatures,
  getSmallestSafeDomTarget,
} from "./features.js";
import { showDomCandidateToast } from "./toast.js";

const observed = new WeakSet();
const allowedSelectors = new Set();
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

export function startDomCandidateCollector() {
  setInterval(scanDomCandidates, 2500);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () =>
      setTimeout(scanDomCandidates, 400),
    );
  } else {
    setTimeout(scanDomCandidates, 400);
  }

  const startObserver = () => {
    if (!document.body) {
      setTimeout(startObserver, 100);
      return;
    }
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) scanNode(node);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  };
  startObserver();
}

async function scanDomCandidates() {
  if (!(await shouldRunDomCollector())) return;
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
  if (observed.has(element) || element.id?.includes("adsfriendly")) return;

  const features = extractDomFeatures(element);
  const decision = decideDomCandidate(features);
  if (decision.action === "observe") return;

  observed.add(element);
  const target = getSmallestSafeDomTarget(element, features);
  const selector = buildDomSelector(target);
  if (selector && allowedSelectors.has(selector)) return;

  const candidate = { element, target, selector, features, decision };
  if (decision.action === "block") {
    hideCandidate(candidate, "heuristic_block");
    return;
  }
  showDomCandidateToast(candidate, {
    onHide: (item) => hideCandidate(item, "user_hide"),
    onAllow: allowCandidate,
  });
}

function hideCandidate(candidate, outcome) {
  BLOCKING_STRATEGIES.STEALTH(candidate.target);
  recordDomSample(candidate, outcome, "ad");
  if (outcome === "user_hide" && candidate.selector)
    persistCustomRule(candidate, outcome);
  chrome.runtime.sendMessage({
    type: "REPORT_AD_DENSITY",
    hostname: location.hostname,
    count: 1,
  });
}

function allowCandidate(candidate) {
  if (candidate.selector) allowedSelectors.add(candidate.selector);
  recordDomSample(candidate, "user_allow", "content");
}

async function persistCustomRule(candidate, outcome) {
  const { userCustomRules = {} } =
    await chrome.storage.local.get("userCustomRules");
  const rules = userCustomRules[location.hostname] || [];
  if (rules.some((rule) => rule.selector === candidate.selector)) return;
  rules.push({
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
  });
  userCustomRules[location.hostname] = rules;
  await chrome.storage.local.set({ userCustomRules });
  chrome.runtime.sendMessage({ type: "SYNC_LEARNING" });
}

async function shouldRunDomCollector() {
  try {
    const { isEnabled, friendlyMode } = await chrome.storage.local.get([
      "isEnabled",
      "friendlyMode",
    ]);
    return isEnabled !== false && friendlyMode === false;
  } catch {
    return false;
  }
}

async function recordDomSample(candidate, outcome, label) {
  try {
    const { domTrainingSamples = [] } =
      await chrome.storage.local.get("domTrainingSamples");
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
            correction: outcome === "user_allow" ? "false_positive" : null,
          }
        : null,
      action: outcome === "user_allow" ? "allow" : "hide",
      outcome,
    };
    domTrainingSamples.push(sample);
    await chrome.storage.local.set({
      domTrainingSamples: domTrainingSamples.slice(-500),
    });
    chrome.runtime.sendMessage({ type: "RECORD_TELEMETRY", event: sample });
  } catch {}
}

function randomId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
