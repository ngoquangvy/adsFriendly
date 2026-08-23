export const NEW_TAB_DECISIONS = Object.freeze({
  ALLOW: "allow",
  CLOSE: "close",
  VERIFY: "verify",
});

export function decideNewTabNavigation({
  sameSite = false,
  trustedInitiator = false,
  trustedTarget = false,
  whitelisted = false,
  blacklisted = false,
  intentMatched = false,
  trustedPath = false,
} = {}) {
  if (
    sameSite ||
    trustedInitiator ||
    trustedTarget ||
    whitelisted ||
    intentMatched ||
    trustedPath
  )
    return NEW_TAB_DECISIONS.ALLOW;
  if (blacklisted) return NEW_TAB_DECISIONS.CLOSE;
  return NEW_TAB_DECISIONS.VERIFY;
}

export function shouldKeepTrackingNewTab({ sameSite = false } = {}) {
  return sameSite;
}
