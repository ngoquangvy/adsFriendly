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
  } else if (message.type === 'NEGATIVE_LEARNING') {
    handleNegativeLearning(message.fingerprint)
      .then(() => sendResponse({ status: 'ok' }))
      .catch(err => console.error("Negative learning error:", err));
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

const PROTECTED_KEYWORDS = [
    'messenger', 'chat', 'inbox', 'cart', 'checkout', 'search', 'account', 'login', 'social', 'notification',
    'swiper', 'carousel', 'slick', 'owl-', 'slide'
];

async function handleNegativeLearning(fingerprint) {
    if (!fingerprint) return;
    const { safePatterns = [], infrastructurePatterns = [] } = await chrome.storage.local.get(['safePatterns', 'infrastructurePatterns']);
    
    const entry = { value: fingerprint.alt || fingerprint.title, type: fingerprint.alt ? 'alt' : 'title' };
    if (!entry.value) return;

    // Add to safe patterns (Potential Infrastructure)
    if (!safePatterns.some(p => p.value === entry.value)) {
        safePatterns.push(entry);
    }
    
    // Explicitly track recently undone parents for refinement
    if (!infrastructurePatterns.some(p => p.value === entry.value)) {
        infrastructurePatterns.push({ ...entry, timestamp: Date.now() });
    }

    await chrome.storage.local.set({ safePatterns, infrastructurePatterns });

    // Clean up global patterns
    const { globalAdPatterns = [] } = await chrome.storage.local.get('globalAdPatterns');
    const filtered = globalAdPatterns.filter(p => p.value !== entry.value);
    await chrome.storage.local.set({ globalAdPatterns: filtered });

    console.log("Deep Reflex: Root element marked as Infrastructure candidate.", entry.value);
}

/**
 * The 'Brain': Aggregates local custom rules into global patterns
 */
async function synthesizeGlobalPatterns() {
    const { userCustomRules = {} } = await chrome.storage.local.get('userCustomRules');
    const { safePatterns = [] } = await chrome.storage.local.get('safePatterns');
    const attrFrequency = {}; 
    const domainSpread = {}; // How many domains use this pattern
    
    // Scan all rules across all domains
    Object.entries(userCustomRules).forEach(([domain, rules]) => {
        rules.forEach(rule => {
            if (rule && rule.fingerprint) {
                const { alt, title, linkDomain } = rule.fingerprint;
                const process = (type, val) => {
                    if (!val || val.length < 3) return;
                    const key = `${type}:${val}`;
                    attrFrequency[key] = (attrFrequency[key] || 0) + 1;
                    if (!domainSpread[key]) domainSpread[key] = new Set();
                    domainSpread[key].add(domain);
                };
                process('alt', alt);
                process('title', title);
                process('domain', linkDomain);
            }
        });
    });

    const isSafe = (type, val) => safePatterns.some(p => p.type === type && p.value === val);
    const isProtected = (val) => PROTECTED_KEYWORDS.some(kw => val.toLowerCase().includes(kw));

    // Synthesize: Ad Patterns = (High Frequency + Low Undo Rate)
    const globalPatterns = Object.entries(attrFrequency)
        .filter(([key, count]) => {
            const [type, value] = key.split(':');
            const spread = domainSpread[key].size;
            
            // Deep Reflex: Even if it's 'Safe' (Undone before), 
            // if it's being specifically zapped AGAIN as a child, 
            // it overrides the safety for that specific pattern.
            // (Handled by verifying current userCustomRules state)
            return !isProtected(value) && spread >= 1;
        })
        .map(([key, count]) => {
            const [type, value] = key.split(':');
            const spread = domainSpread[key].size;
            
            // Boost confidence if it's frequently zapped despite common safe ancestors
            let confidence = Math.min((count + (spread * 2)) / 10, 1.0);
            
            // Penalty if it was explicitly marked safe
            if (isSafe(type, value)) confidence *= 0.3;

            return { type, value, confidence };
        });

    await chrome.storage.local.set({ globalAdPatterns: globalPatterns });
    console.log("Deep Reflex: Brain synthesize complete. Active patterns:", globalPatterns.length);
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

// Core System Whitelist (Total Immunity)
const CORE_SYSTEM_DOMAINS = ['cloudflare.com', 'google.com', 'github.com', 'stackexchange.com', 'stackoverflow.com'];

// Helper to check if a hostname is a core system domain
function isCoreSystem(hostname) {
  return CORE_SYSTEM_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
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

    // Total System Immunity: Bypass if source or target is a core administrative domain
    if (isCoreSystem(sourceUrl.hostname) || isCoreSystem(targetDomain)) {
        return;
    }

    // 1. Check Whitelist (User Defined)
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
