export const DECISION_ACTIONS = Object.freeze({
  ALLOW: "allow",
  BLOCK: "block",
  TOAST: "toast",
  OBSERVE: "observe",
});

export function createDecision(action, options = {}) {
  return {
    action,
    confidence: clampConfidence(options.confidence ?? 0),
    reasons: Array.isArray(options.reasons) ? options.reasons : [],
    target: options.target || null,
    metadata: options.metadata || {},
  };
}

function clampConfidence(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
