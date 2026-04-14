// Background Service Worker for Smart BlockAd

// Store the timestamp of the last trusted click from content scripts
let lastTrustedClick = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRUSTED_CLICK') {
    lastTrustedClick = Date.now();
  } else if (message.type === 'TOGGLE_STATUS') {
    // Optionally handle any immediate logic when disabled
    console.log("Protection status:", message.isEnabled);
  }
});

// Helper to increment blocked count
async function incrementBlockedCount() {
  const result = await chrome.storage.local.get(['blockedCount']);
  const count = (result.blockedCount || 0) + 1;
  await chrome.storage.local.set({ blockedCount: count });
}

// Listen for new tab creation
chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  const { sourceTabId, tabId, url } = details;
  
  try {
    // Check if protection is enabled
    const settings = await chrome.storage.local.get(['isEnabled']);
    if (settings.isEnabled === false) return;

    // Get info about the tab that opened this new one
    const sourceTab = await chrome.tabs.get(sourceTabId);
    if (!sourceTab || !sourceTab.url) return;

    const sourceUrl = new URL(sourceTab.url);
    const targetUrl = new URL(url);

    // If target domain is different from source domain
    if (sourceUrl.hostname !== targetUrl.hostname) {
      const timeSinceClick = Date.now() - lastTrustedClick;
      
      // If no trusted click recently OR just suspicious different domain
      // Redirect the NEW tab to our blocked page
      const blockedUrl = chrome.runtime.getURL(`ui/blocked.html?url=${encodeURIComponent(url)}&source=${encodeURIComponent(sourceUrl.hostname)}`);
      
      chrome.tabs.update(tabId, { url: blockedUrl });
      await incrementBlockedCount();
    }
  } catch (err) {
    console.error("Error evaluating navigation:", err);
  }
});

// Tab-under prevention
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // If the "opener" tab changes its URL immediately after opening a popup
  // This logic can be expanded to detect tab-under specifically
});
