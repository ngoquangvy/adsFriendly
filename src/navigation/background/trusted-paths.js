import { getSettingsMutationStore } from "../../background/settings-mutations.js";
import { resolveNavigationDecisionTarget } from "../shared/search-navigation.js";

export async function syncTrustedPath(source, target, isManual = false) {
  if (!source || !target || source === target) return;
  const key = `p:${source}>${target}`;
  const current = await chrome.storage.local.get([key]);
  const entry = current[key] || {
    source,
    target,
    visits: 0,
    isManual: false,
    lastUpdated: Date.now(),
  };
  entry.visits++;
  if (isManual) {
    entry.isManual = true;
    entry.visits = Math.max(entry.visits, 99);
  }
  entry.lastUpdated = Date.now();
  await chrome.storage.local.set({ [key]: entry });
}

export async function getTrustedPath(source, target) {
  const key = `p:${source}>${target}`;
  return (await chrome.storage.local.get([key]))[key] || null;
}

export async function removeTrustedPath(source, target) {
  if (!source || !target || source === target) return false;
  const key = `p:${source}>${target}`;
  await chrome.storage.local.remove(key);
  return true;
}

export async function handleUserDecision(message) {
  const { action } = message;
  if (!["WHITELIST", "BLACKLIST"].includes(action)) return;
  const decision = resolveNavigationDecisionTarget(message);
  if (decision.scope === "navigation_only") {
    return { status: "navigation_only", action };
  }
  return getSettingsMutationStore().saveDomainDecision(action, decision.domain);
}
