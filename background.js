// Background Service Worker for Smart BlockAd

// Store the timestamp of the last trusted click from content scripts
let lastTrustedClick = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRUSTED_CLICK') {
    lastTrustedClick = Date.now();
  } else if (message.type === 'TOGGLE_STATUS') {
    console.log("Protection status:", message.isEnabled);
  } else if (message.type === 'SYNC_LEARNING') {
    synthesizeGlobalPatterns()
      .then(() => sendResponse({ status: 'ok' }))
      .catch(err => {
        console.error("Learning error:", err);
        sendResponse({ status: 'error' });
      });
    return true;
  } else if (message.type === 'USER_DECISION') {
    handleUserDecision(message)
      .then(() => {
        sendResponse({ status: 'ok' });
      })
      .catch(err => {
        console.error("User decision error:", err);
        sendResponse({ status: 'error', error: err.message });
      });
    return true; // Keep channel open for async response
  }
});

/**
 * The 'Brain': Aggregates local custom rules into global patterns
 */
async function synthesizeGlobalPatterns() {
    const { userCustomRules = {} } = await chrome.storage.local.get('userCustomRules');
    const attrFrequency = {}; // Track alt/title frequency
    
    // Scan all rules across all domains
    Object.values(userCustomRules).flat().forEach(rule => {
        if (rule && rule.fingerprint) {
            const { alt, title } = rule.fingerprint;
            if (alt && alt.length > 2) attrFrequency[`alt:${alt}`] = (attrFrequency[`alt:${alt}`] || 0) + 1;
            if (title && title.length > 2) attrFrequency[`title:${title}`] = (attrFrequency[`title:${title}`] || 0) + 1;
        }
    });

    // Patterns that appeared on more than 1 domain are "High Confidence"
    const globalPatterns = Object.entries(attrFrequency)
        .filter(([key, count]) => count >= 1) // Set to >= 2 for production, 1 for testing
        .map(([key, count]) => {
            const [type, value] = key.split(':');
            return { type, value, confidence: Math.min(count / 5, 1.0) };
        });

    await chrome.storage.local.set({ globalAdPatterns: globalPatterns });
    console.log("Brain synthesize complete. Patterns learned:", globalPatterns.length);
}

// Layer 2: In-page Blocking (DNR Ruleset)
async function toggleInPageBlocking(enabled) {
  try {
    if (enabled) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: ["ruleset_1"]
      });
    } else {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: ["ruleset_1"]
      });
    }
    console.log("DNR Ruleset updated:", enabled);
  } catch (err) {
    console.error("DNR update error:", err);
  }
}

// Auto-off: No longer used on startup to persist user choice
// Reset ONLY on first installation if not set
chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.local.get(['friendlyMode', 'isEnabled']);
  
  if (result.friendlyMode === undefined) {
    await chrome.storage.local.set({ friendlyMode: true });
    toggleInPageBlocking(false); // Friendly ON = Blocking OFF
  }
  
  if (result.isEnabled === undefined) {
    await chrome.storage.local.set({ isEnabled: true });
  }
});

// Separate handler for cleaner async/await
async function handleUserDecision(message) {
  const { action, domain } = message;
  
  if (action === 'WHITELIST') {
    const { whitelist = [] } = await chrome.storage.local.get(['whitelist']);
    if (!whitelist.includes(domain)) {
      whitelist.push(domain);
      await chrome.storage.local.set({ whitelist });
    }
  } else if (action === 'BLACKLIST') {
    const { blacklist = [] } = await chrome.storage.local.get(['blacklist']);
    const standardRule = `||${domain}^`;
    if (!blacklist.includes(standardRule)) {
      blacklist.push(standardRule);
      await chrome.storage.local.set({ blacklist });
    }
  }
}

// Helper to update badge
async function updateBadge() {
  const { blockedCount = 0 } = await chrome.storage.local.get(['blockedCount']);
  if (blockedCount > 0) {
    chrome.action.setBadgeText({ text: blockedCount.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#FF4D4C' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Helper to increment blocked count
async function incrementBlockedCount() {
  const result = await chrome.storage.local.get(['blockedCount']);
  const count = (result.blockedCount || 0) + 1;
  await chrome.storage.local.set({ blockedCount: count });
  updateBadge();
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
    if (!sourceTab || !sourceTab.url || !sourceTab.url.startsWith('http')) return;

    const sourceUrl = new URL(sourceTab.url);
    const targetUrl = new URL(url);
    const targetDomain = targetUrl.hostname;

    // 1. Check Whitelist
    const { whitelist = [] } = await chrome.storage.local.get(['whitelist']);
    if (whitelist.includes(targetDomain)) return;

    // 2. Check Blacklist (Silent Kill) - Custom JS Logic
    const { blacklist = [] } = await chrome.storage.local.get(['blacklist']);
    const isBlacklisted = blacklist.some(rule => {
      const domain = rule.replace('||', '').replace('^', '');
      return targetDomain === domain || targetDomain.endsWith('.' + domain);
    });

    if (isBlacklisted) {
      chrome.tabs.remove(tabId);
      await incrementBlockedCount();
      return;
    }

    // 3. Cross-domain check
    if (sourceUrl.hostname !== targetUrl.hostname) {
      const timeSinceClick = Date.now() - lastTrustedClick;
      
      // If it's a suspicious different domain
      const blockedUrl = chrome.runtime.getURL(`ui/blocked.html?url=${encodeURIComponent(url)}&source=${encodeURIComponent(sourceUrl.hostname)}`);
      
      chrome.tabs.update(tabId, { url: blockedUrl });
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
