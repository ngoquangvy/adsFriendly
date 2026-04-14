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
  } else if (message.type === 'REPORT_AD_DENSITY') {
    updateSiteReputation(message.hostname, message.count)
      .then(() => sendResponse({ status: 'ok' }))
      .catch(() => sendResponse({ status: 'error' }));
    return true;
  }
});

async function updateSiteReputation(hostname, blockedCount) {
    const { siteReputation = {} } = await chrome.storage.local.get('siteReputation');
    if (!siteReputation[hostname]) {
        siteReputation[hostname] = { trustScore: 0.5, blockActivity: 0 };
    }

    const data = siteReputation[hostname];
    data.blockActivity = Math.max(data.blockActivity, blockedCount);
    
    // If a site has more than 10 blocks, it starts losing trust
    if (blockedCount > 10) {
        data.trustScore = Math.max(0, data.trustScore - 0.05);
    } else if (blockedCount <= 1) {
        data.trustScore = Math.min(1, data.trustScore + 0.01);
    }

    await chrome.storage.local.set({ siteReputation });
}

async function cleanupStaleMemory() {
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const { siteResetHistory = {} } = await chrome.storage.local.get('siteResetHistory');
    
    let changed = false;
    for (const hostname in siteResetHistory) {
        if (now - siteResetHistory[hostname].timestamp > THIRTY_DAYS) {
            delete siteResetHistory[hostname];
            changed = true;
        }
    }

    if (changed) {
        await chrome.storage.local.set({ siteResetHistory });
        console.log('[AdsFriendly Background] Stale behavioral memory cleaned up.');
    }
}

// Trigger cleanup on Startup
chrome.runtime.onStartup.addListener(cleanupStaleMemory);
// Also run it now if just installed or updated
cleanupStaleMemory();

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
  const result = await chrome.storage.local.get(['friendlyMode', 'isEnabled', 'globalAdPatterns']);
  
  // Seed the "Basic Brain" (Global Ad Patterns) for Public Baseline v1.0
  if (!result.globalAdPatterns || result.globalAdPatterns.length === 0) {
    const baselineSeeds = [
      { type: 'alt', value: 'Ad', confidence: 0.9 },
      { type: 'alt', value: 'Advertisement', confidence: 0.9 },
      { type: 'alt', value: 'Sponsored', confidence: 0.9 },
      { type: 'alt', value: 'Promoted', confidence: 0.9 },
      { type: 'title', value: 'Ads by Google', confidence: 1.0 },
      { type: 'domain', value: 'taboola.com', confidence: 1.0 },
      { type: 'domain', value: 'outbrain.com', confidence: 1.0 },
      { type: 'domain', value: 'mgid.com', confidence: 1.0 },
      { type: 'domain', value: 'adnxs.com', confidence: 1.0 }
    ];
    await chrome.storage.local.set({ globalAdPatterns: baselineSeeds });
    console.log('[AdsFriendly AI] Basic Brain seeded with baseline patterns for public release.');
  }

  if (result.friendlyMode === undefined) {
    await chrome.storage.local.set({ friendlyMode: true });
    toggleInPageBlocking(false); 
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

// Helper to analyze if an URL is a stealth ad/pop-under
function isSuspiciousURL(url, globalPatterns = []) {
    try {
        const u = new URL(url);
        // 1. Parameter patterns
        const suspiciousParams = ['utm_', 'aff_', 'clickid', 'pop_', 'bannerid', 'zoneid'];
        if (suspiciousParams.some(p => u.search.includes(p))) return true;

        // 2. Domain Match with AI Brain
        const domainMatch = globalPatterns.some(p => p.type === 'domain' && u.hostname.includes(p.value));
        if (domainMatch) return true;

        return false;
    } catch (e) { return false; }
}

// Get Dynamic Trust Window based on site reputation
async function getDynamicTrustWindow(hostname) {
    const { siteReputation = {} } = await chrome.storage.local.get('siteReputation');
    const rep = siteReputation[hostname];
    if (rep && rep.blockedAdCount > 10) return 500; // Strict for ad-heavy sites
    return 2000; // Default
}

// Listen for new tab creation
chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  const { sourceTabId, tabId, url } = details;
  
  try {
    const { isEnabled, globalAdPatterns = [] } = await chrome.storage.local.get(['isEnabled', 'globalAdPatterns']);
    if (isEnabled === false) return;

    const sourceTab = await chrome.tabs.get(sourceTabId);
    if (!sourceTab || !sourceTab.url || !sourceTab.url.startsWith('http')) return;

    const sourceUrl = new URL(sourceTab.url);
    const targetUrl = new URL(url);
    const targetDomain = targetUrl.hostname;

    if (sourceUrl.hostname === targetDomain) return;

    // v2.5 MUST-KILL Check: If the URL is suspicious, kill it regardless of clicks
    if (isSuspiciousURL(url, globalAdPatterns)) {
        console.log(`%c[AdsFriendly AI] Stealth Pop-under neutralized: ${targetDomain}`, "color: #ef4444; font-weight: bold;");
        await logBlockedNavigation(url, sourceUrl.hostname);
        const blockedUrl = chrome.runtime.getURL(`ui/blocked.html?url=${encodeURIComponent(url)}&source=${encodeURIComponent(sourceUrl.hostname)}`);
        chrome.tabs.update(tabId, { url: blockedUrl });
        return;
    }

    // 1. Deep Pulse: Check Sharded Trusted Path
    const shardKey = `p:${sourceUrl.hostname}>${targetDomain}`;
    const pulseResult = await chrome.storage.local.get([shardKey]);
    const path = pulseResult[shardKey];

    if (path && (path.isManual || path.visits >= 3)) return; 

    // 2. Check Whitelist
    const { whitelist = [] } = await chrome.storage.local.get(['whitelist']);
    if (whitelist.includes(targetDomain)) return;

    // 3. Evaluation: Dynamic Trust Window
    const trustWindow = await getDynamicTrustWindow(sourceUrl.hostname);
    const timeSinceClick = Date.now() - lastTrustedClick;

    if (timeSinceClick > trustWindow) {
      console.log(`[AdsFriendly AI] Blocked unauthorized new tab: ${targetDomain} (Window: ${trustWindow}ms)`);
      await logBlockedNavigation(url, sourceUrl.hostname);
      const blockedUrl = chrome.runtime.getURL(`ui/blocked.html?url=${encodeURIComponent(url)}&source=${encodeURIComponent(sourceUrl.hostname)}`);
      chrome.tabs.update(tabId, { url: blockedUrl });
    } else {
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
