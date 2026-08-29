import { ruleMatchesResponsiveLayout } from "./layout-context.js";
import { isReusableDomSelector } from "./features.js";

const VALID_LAYOUTS = new Set(["any", "compact", "wide"]);

export function createElementException(
  candidate,
  { id = randomId(), timestamp = Date.now(), layout = "any" } = {},
) {
  const selector = candidate?.selector;
  const fingerprint = elementExceptionFingerprint(candidate?.features);
  if (
    !isReusableDomSelector(selector) ||
    !hasStableElementIdentity(fingerprint)
  )
    throw new Error(
      "This element has no stable identity to remember safely. Dismiss it once with ×.",
    );
  return {
    id,
    selector,
    fingerprint,
    timestamp,
    confidence: clampConfidence(candidate.decision?.confidence),
    source: "user_not_ad",
    layout: VALID_LAYOUTS.has(layout) ? layout : "any",
  };
}

export function elementExceptionFingerprint(features = {}) {
  return {
    tag: clean(features.tag, 30),
    id: clean(features.id, 160),
    className: clean(features.className, 300),
    alt: clean(features.alt, 300),
    title: clean(features.title, 300),
    linkDomain: clean(features.hrefHost, 253).toLowerCase(),
    srcHost: clean(features.srcHost, 253).toLowerCase(),
    idTokens: normalizedTokens(features.idTokens),
    classTokens: normalizedTokens(features.classTokens),
    descendantLinkHosts: normalizedHosts(features.descendants?.hrefHosts),
    descendantSrcHosts: normalizedHosts(features.descendants?.srcHosts),
  };
}

export function matchesElementException(
  rule,
  { selector, features, layout } = {},
) {
  if (!rule || typeof rule !== "object") return false;
  if (!isReusableDomSelector(selector) || rule.selector !== selector)
    return false;
  if (!ruleMatchesResponsiveLayout(rule, layout)) return false;
  const expected = rule.fingerprint;
  if (!expected || typeof expected !== "object") return false;
  const actual = elementExceptionFingerprint(features);
  if (expected.tag && expected.tag !== actual.tag) return false;

  let identityScore = 0;
  for (const key of ["linkDomain", "srcHost", "id", "alt", "title"]) {
    if (!expected[key]) continue;
    if (!actual[key] || expected[key] !== actual[key]) return false;
    identityScore += ["linkDomain", "srcHost"].includes(key) ? 3 : 2;
  }
  if (expected.className) {
    if (expected.className === actual.className) identityScore += 1;
    else return false;
  }
  if (tokenOverlap(expected.idTokens, actual.idTokens)) identityScore += 2;
  if (tokenOverlap(expected.classTokens, actual.classTokens))
    identityScore += 1;
  for (const key of ["descendantLinkHosts", "descendantSrcHosts"]) {
    if (!Array.isArray(expected[key]) || !expected[key].length) continue;
    if (!sameValues(expected[key], actual[key])) return false;
    identityScore += 3;
  }

  // Host-, label-, id-, or class-derived selectors are stable enough when the
  // stored fingerprint has no contradiction. Structural selectors require a
  // corroborating identity signal so a reused page slot is not suppressed.
  return identityScore > 0 || isIdentitySelector(selector);
}

export function elementExceptionKey(rule) {
  if (typeof rule?.id === "string" && rule.id.trim()) return rule.id.trim();
  return [
    rule?.selector || "",
    rule?.layout || "any",
    rule?.fingerprint?.linkDomain || "",
    rule?.fingerprint?.srcHost || "",
    rule?.fingerprint?.id || "",
    rule?.fingerprint?.alt || "",
    rule?.fingerprint?.title || "",
    ...(rule?.fingerprint?.classTokens || []),
  ].join("|");
}

function tokenOverlap(expected, actual) {
  if (!Array.isArray(expected) || !expected.length || !Array.isArray(actual))
    return false;
  const actualTokens = new Set(actual);
  return expected.some((token) => actualTokens.has(token));
}

function isIdentitySelector(selector) {
  return (
    /^#[^\s>+~]+$/.test(selector) ||
    /^[a-z][a-z0-9-]*\.[^\s>+~]+$/i.test(selector) ||
    /\[(?:href|src|alt|title|aria-label)[*^$]?=/i.test(selector)
  );
}

function normalizedTokens(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => clean(value, 80).toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 40);
}

function normalizedHosts(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => clean(value, 253).toLowerCase())
        .filter((value) => /^[a-z0-9.-]+$/.test(value)),
    ),
  ]
    .sort()
    .slice(0, 12);
}

function sameValues(expected, actual) {
  if (!Array.isArray(actual) || expected.length !== actual.length) return false;
  return expected.every((value, index) => value === actual[index]);
}

function hasStableElementIdentity(fingerprint) {
  return Boolean(
    fingerprint.id ||
    fingerprint.className ||
    fingerprint.alt ||
    fingerprint.title ||
    fingerprint.linkDomain ||
    fingerprint.srcHost ||
    fingerprint.idTokens.length ||
    fingerprint.classTokens.length ||
    fingerprint.descendantLinkHosts.length ||
    fingerprint.descendantSrcHosts.length,
  );
}

function clean(value, maximumLength = 300) {
  return String(value || "")
    .trim()
    .slice(0, maximumLength);
}

function clampConfidence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function randomId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `not-ad-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
