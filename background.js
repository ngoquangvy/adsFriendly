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
      .then(() => sendResponse({ status: 'ok' }))
      .catch(err => sendResponse({ status: 'error', error: err.message }));
    return true;
  } else if (message.type === 'PATH_RESTORED') {
    syncTrustedPath(message.source, message.target, true)
      .then(() => sendResponse({ status: 'ok' }))
      .catch(err => sendResponse({ status: 'error' }));
    return true;
  } else if (message.type === 'LEARN_VIDEO_AD') {
    handleLearnVideoAd(message)
      .then(() => sendResponse({ status: 'ok' }))
      .catch(() => sendResponse({ status: 'error' }));
    return true;
  } else if (message.type === 'SYNC_VIDEO_LEARNING') {
    handleVideoLearning(message)
      .then(() => sendResponse({ status: 'ok' }))
      .catch(() => sendResponse({ status: 'error' }));
    return true;
  }
});

async function handleLearnVideoAd(data) {
    const { src, hostname } = data;
    if (!src) return;

    let patternValue = src;
    try {
        const url = new URL(src);
        // If it's a known cloud host, learn the domain. If it's a specific path, find the pattern.
        if (url.hostname.includes('github') || url.hostname.includes('s3') || url.hostname.includes('cdn')) {
            patternValue = url.hostname;
        } else {
            // Take the domain + first part of path
            const pathParts = url.pathname.split('/');
            patternValue = url.hostname + (pathParts[1] ? '/' + pathParts[1] : '');
        }
    } catch (e) {
        // Fallback to substring if not a valid URL
        patternValue = src.split('?')[0].substring(0, 50);
    }

    const { globalAdPatterns = [] } = await chrome.storage.local.get(['globalAdPatterns']);
    
    const existing = globalAdPatterns.find(p => p.type === 'video_source_marker' && p.value === patternValue);
    
    if (existing) {
        existing.confidence = 1.0; // User manual mark is definitive
    } else {
        globalAdPatterns.push({
            type: 'video_source_marker',
            value: patternValue,
            confidence: 1.0,
            source: hostname
        });
    }

    await chrome.storage.local.set({ globalAdPatterns });
    console.log('[AdsFriendly Brain] New Video Ad Source learned:', patternValue);
}

async function handleVideoLearning(data) {
    const { classes, hostname } = data;
    if (!classes) return;

    const classList = classes.split(' ').filter(c => 
        c.includes('ad') || c.includes('player') || c.includes('video')
    );

    if (classList.length === 0) return;

    const { globalAdPatterns = [] } = await chrome.storage.local.get(['globalAdPatterns']);
    
    classList.forEach(cls => {
        const patternValue = `.${cls}`;
        const existing = globalAdPatterns.find(p => p.type === 'video_marker' && p.value === patternValue);
        
        if (existing) {
            existing.confidence = Math.min(1.0, existing.confidence + 0.1);
        } else {
            globalAdPatterns.push({
                type: 'video_marker',
                value: patternValue,
                confidence: 0.5,
                source: hostname
            });
        }
    });

    await chrome.storage.local.set({ globalAdPatterns });
    console.log('[AdsFriendly Brain] Video ad tokens learned:', classList);
}

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

/**
 * Deep Pulse: Workflow Learning Engine
 */
async function syncTrustedPath(source, target, isManual = false) {
    if (!source || !target || source === target) return;
    const shardKey = `p:${source}>${target}`;
    
    const result = await chrome.storage.local.get([shardKey]);
    const entry = result[shardKey] || { source, target, visits: 0, isManual: false, lastUpdated: Date.now() };
    
    entry.visits++;
    if (isManual) {
        entry.isManual = true;
        entry.visits = Math.max(entry.visits, 99); // Immediate trust threshold
    }
    entry.lastUpdated = Date.now();
    
    await chrome.storage.local.set({ [shardKey]: entry });
    console.log(`[AdsFriendly Pulse] Path learned: ${source} -> ${target} (Visits: ${entry.visits}, Manual: ${entry.isManual})`);
}

async function logBlockedNavigation(url, source) {
    const { blockedLogs = [] } = await chrome.storage.local.get(['blockedLogs']);
    const entry = { url, source, timestamp: Date.now() };
    
    // Keep only last 20 events
    const updated = [entry, ...blockedLogs].slice(0, 20);
    await chrome.storage.local.set({ blockedLogs: updated });
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

// Core System Whitelist (Total Immunity - Optional SOFT usage)
const CORE_SYSTEM_DOMAINS = ['cloudflare.com', 'google.com', 'github.com', 'stackexchange.com', 'stackoverflow.com'];
function isCoreSystem(hostname) {
  return CORE_SYSTEM_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
}

// Listen for new tab creation
chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  const { sourceTabId, tabId, url } = details;
  
  try {
    const settings = await chrome.storage.local.get(['isEnabled']);
    if (settings.isEnabled === false) return;

    const sourceTab = await chrome.tabs.get(sourceTabId);
    if (!sourceTab || !sourceTab.url || !sourceTab.url.startsWith('http')) return;

    const sourceUrl = new URL(sourceTab.url);
    const targetUrl = new URL(url);
    const targetDomain = targetUrl.hostname;

    if (sourceUrl.hostname === targetDomain) return;

    // 1. Deep Pulse: Check Sharded Trusted Path (O(1) Performance)
    const shardKey = `p:${sourceUrl.hostname}>${targetDomain}`;
    const pulseResult = await chrome.storage.local.get([shardKey]);
    const path = pulseResult[shardKey];

    if (path && (path.isManual || path.visits >= 3)) {
        console.log(`[AdsFriendly Pulse] Authorized path detected: ${sourceUrl.hostname} -> ${targetDomain}`);
        return; 
    }

    // 2. Check Whitelist (User Defined)
    const { whitelist = [] } = await chrome.storage.local.get(['whitelist']);
    if (whitelist.includes(targetDomain)) {
        syncTrustedPath(sourceUrl.hostname, targetDomain); // Learn the successful path
        return;
    }

    // 3. Evaluation: Cross-domain check
    const timeSinceClick = Date.now() - lastTrustedClick;
    if (timeSinceClick > 2000) { // Suspicious if no recent manual click
      await logBlockedNavigation(url, sourceUrl.hostname);
      const blockedUrl = chrome.runtime.getURL(`ui/blocked.html?url=${encodeURIComponent(url)}&source=${encodeURIComponent(sourceUrl.hostname)}`);
      chrome.tabs.update(tabId, { url: blockedUrl });
    } else {
      // Valid trusted click - Learn this path naturally
      syncTrustedPath(sourceUrl.hostname, targetDomain);
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
