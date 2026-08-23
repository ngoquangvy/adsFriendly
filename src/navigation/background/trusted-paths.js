import { getSettingsMutationStore } from "../../background/settings-mutations.js";

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

export async function handleUserDecision(message) {
  const { action, domain } = message;
  if (!["WHITELIST", "BLACKLIST"].includes(action)) return;
  return getSettingsMutationStore().saveDomainDecision(action, domain);
}
