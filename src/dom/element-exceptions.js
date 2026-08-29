import { ruleMatchesResponsiveLayout } from "./layout-context.js";

const VALID_LAYOUTS = new Set(["any", "compact", "wide"]);

export function createElementException(
  candidate,
  { id = randomId(), timestamp = Date.now(), layout = "any" } = {},
) {
  if (!candidate?.selector) {
    throw new Error("This element does not have a reusable selector.");
  }
  return {
    id,
    selector: candidate.selector,
    fingerprint: elementExceptionFingerprint(candidate.features),
    timestamp,
    confidence: clampConfidence(candidate.decision?.confidence),
    source: "user_not_ad",
    layout: VALID_LAYOUTS.has(layout) ? layout : "any",
  };
}

export function elementExceptionFingerprint(features = {}) {
  return {
    tag: clean(features.tag),
    id: clean(features.id),
    className: clean(features.className),
    alt: clean(features.alt),
    title: clean(features.title),
    linkDomain: clean(features.hrefHost).toLowerCase(),
    srcHost: clean(features.srcHost).toLowerCase(),
    idTokens: normalizedTokens(features.idTokens),
    classTokens: normalizedTokens(features.classTokens),
  };
}

export function matchesElementException(
  rule,
  { selector, features, layout } = {},
) {
  if (!rule || typeof rule !== "object") return false;
  if (!selector || rule.selector !== selector) return false;
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
    else if (!tokenOverlap(expected.classTokens, actual.classTokens))
      return false;
  }
  if (tokenOverlap(expected.idTokens, actual.idTokens)) identityScore += 2;
  if (tokenOverlap(expected.classTokens, actual.classTokens))
    identityScore += 1;

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
        .map((value) => clean(value).toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 40);
}

function clean(value) {
  return String(value || "").trim();
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
