const PROBE_RULE_ID_BASE = 1_700_000;
const PROBE_RULE_LIFETIME_MS = 6_000;
let nextRuleId = PROBE_RULE_ID_BASE;

export async function prepareMediaProbeReferer({
  tabId,
  manifestUrl,
  parentDocumentUrl,
  frameDocumentUrl,
}) {
  const ruleId = nextProbeRuleId();
  const rule = createMediaProbeRefererRule({
    ruleId,
    tabId,
    manifestUrl,
    parentDocumentUrl,
    frameDocumentUrl,
  });
  const support = await chrome.declarativeNetRequest.isRegexSupported({
    regex: rule.condition.regexFilter,
  });
  if (!support?.isSupported) {
    return { status: "unsupported", reason: support?.reason || "regex" };
  }
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId],
    addRules: [rule],
  });
  setTimeout(() => {
    chrome.declarativeNetRequest
      .updateSessionRules({ removeRuleIds: [ruleId] })
      .catch(() => {});
  }, PROBE_RULE_LIFETIME_MS);
  return { status: "prepared", ruleId };
}

export function createMediaProbeRefererRule({
  ruleId,
  tabId,
  manifestUrl,
  parentDocumentUrl,
  frameDocumentUrl = parentDocumentUrl,
}) {
  if (!Number.isInteger(ruleId) || ruleId <= 0)
    throw new TypeError("Media probe rule needs a positive integer ID.");
  if (!Number.isInteger(tabId) || tabId < 0)
    throw new TypeError("Media probe rule needs a valid tab ID.");
  const manifest = requiredHttpUrl(manifestUrl, "manifestUrl");
  const parent = requiredHttpUrl(parentDocumentUrl, "parentDocumentUrl");
  const frame = requiredHttpUrl(frameDocumentUrl, "frameDocumentUrl");
  return {
    id: ruleId,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "Referer", operation: "set", value: parent.href },
        { header: "Origin", operation: "set", value: frame.origin },
      ],
    },
    condition: {
      regexFilter: `^${escapeRegex(manifest.href)}$`,
      resourceTypes: ["xmlhttprequest"],
      tabIds: [tabId],
    },
  };
}

function nextProbeRuleId() {
  const ruleId = nextRuleId;
  nextRuleId += 1;
  if (nextRuleId > PROBE_RULE_ID_BASE + 100_000)
    nextRuleId = PROBE_RULE_ID_BASE;
  return ruleId;
}

function requiredHttpUrl(value, field) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${field} must be an HTTP URL.`);
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new TypeError(`${field} must be an HTTP URL.`);
  return url;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
