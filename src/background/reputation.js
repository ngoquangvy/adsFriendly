export async function updateSiteReputation(hostname, blockedCount) {
  const { siteReputation = {} } =
    await chrome.storage.local.get("siteReputation");
  const data = (siteReputation[hostname] ||= {
    trustScore: 0.5,
    blockActivity: 0,
  });
  data.blockActivity = Math.max(data.blockActivity, blockedCount);
  if (blockedCount > 10) data.trustScore = Math.max(0, data.trustScore - 0.05);
  else if (blockedCount <= 1)
    data.trustScore = Math.min(1, data.trustScore + 0.01);
  await chrome.storage.local.set({ siteReputation });
}
export async function getDynamicTrustWindow(hostname) {
  const { siteReputation = {} } =
    await chrome.storage.local.get("siteReputation");
  return siteReputation[hostname]?.blockedAdCount > 10 ? 500 : 2000;
}
export async function cleanupStaleMemory() {
  const { siteResetHistory = {} } =
    await chrome.storage.local.get("siteResetHistory");
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const host in siteResetHistory)
    if (siteResetHistory[host].timestamp < cutoff) {
      delete siteResetHistory[host];
      changed = true;
    }
  if (changed) await chrome.storage.local.set({ siteResetHistory });
}
