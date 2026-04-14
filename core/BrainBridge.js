/**
 * AdsFriendly: BrainBridge (v4.1)
 * The authoritative bridge between client sensors and the underlying intelligence (Local/Remote).
 */
const BrainBridge = {
    mode: 'LOCAL',
    
    // Tier 1: Personal overrides (strictly local)
    personalRules: {},
    
    // Tier 2: Learned buffer (awaiting standardization)
    learnedBuffer: [],
    
    // Tier 3: Global patterns (synced from server)
    globalPatterns: [],

    async init() {
        const data = await chrome.storage.local.get(['userCustomRules', 'globalAdPatterns', 'personalOverrides']);
        this.personalRules = data.personalOverrides || {};
        this.globalPatterns = data.globalAdPatterns || [];
        console.log('[AdsFriendly Bridge] Multi-tier brain initialized in', this.mode, 'mode.');
    },

    // Standardize a raw DOM signal before promoting/syncing
    standardize(selector) {
        if (!selector) return null;
        // Logic: Replace randomized numbers with wildcards (e.g., ad-1234 -> ad-*)
        let clean = selector.replace(/-\d+$/, '-*');
        clean = clean.replace(/:\d+$/, ':*'); // Handle YouTube-style colon IDs
        return clean;
    },

    async recordDecision(entry) {
        // Defensive check: Is extension still valid?
        if (!chrome.runtime || !chrome.runtime.id) return;

        // Prepare Decision Log
        const logEntry = {
            ...entry,
            timestamp: Date.now()
        };

        // RELAY MODEL: Primary method is sending to Background for guaranteed storage
        try {
            chrome.runtime.sendMessage({ type: 'LOG_NEURAL_DECISION', entry: logEntry });
        } catch (e) {
            // Fallback: Attempt local storage if background is unreachable
            const { neuroLogs = [] } = await chrome.storage.local.get(['neuroLogs']);
            neuroLogs.unshift(logEntry);
            if (neuroLogs.length > 50) neuroLogs.length = 50;
            await chrome.storage.local.set({ neuroLogs });
        }
        
        // If high confidence, consider promoting to learnedBuffer
        if (entry.final_confidence > 0.9) {
            this.promoteToBuffer(entry);
        }
    },

    async recordIntelligence(data) {
        if (!chrome.runtime || !chrome.runtime.id) return;

        try {
            // Forward to background for archival
            chrome.runtime.sendMessage({ type: 'HARVEST_INTELLIGENCE', data: { ...data, timestamp: Date.now() } });
        } catch (e) {
            // Local fallback for genomes
            if (data.type === 'AD_GENOME_HARVEST') {
                const { adGenomes = [] } = await chrome.storage.local.get(['adGenomes']);
                adGenomes.unshift(data.genome);
                if (adGenomes.length > 100) adGenomes.length = 100;
                await chrome.storage.local.set({ adGenomes });
            }
        }
    },

    async promoteToBuffer(entry) {
        const cleanSelector = this.standardize(entry.reasoning.primarySelector);
        if (!cleanSelector) return;

        const { pendingRules = [] } = await chrome.storage.local.get(['pendingRules']);
        if (!pendingRules.find(r => r.selector === cleanSelector)) {
            pendingRules.push({
                selector: cleanSelector,
                site: entry.site,
                count: 1,
                lastSeen: Date.now()
            });
            await chrome.storage.local.set({ pendingRules });
        }
    },

    async confirmLearnedMarker(selector, site) {
        if (!chrome.runtime || !chrome.runtime.id) return;
        
        const { discoveredMarkers = [] } = await chrome.storage.local.get(['discoveredMarkers']);
        const { pendingRules = [] } = await chrome.storage.local.get(['pendingRules']);

        const existing = discoveredMarkers.includes(selector);
        if (!existing) {
            discoveredMarkers.push(selector);
            await chrome.storage.local.set({ discoveredMarkers });
            
            // Also stage for community audit
            const ruleExists = pendingRules.find(r => r.selector === selector);
            if (!ruleExists) {
                pendingRules.push({ selector, site, count: 1, type: 'learned_skip', lastSeen: Date.now() });
                await chrome.storage.local.set({ pendingRules });
            }
        }
    },

    async penalizeMarker(selector) {
        if (!chrome.runtime || !chrome.runtime.id) return;
        
        const { suspiciousMarkers = [] } = await chrome.storage.local.get(['suspiciousMarkers']);
        if (!suspiciousMarkers.includes(selector)) {
            suspiciousMarkers.push(selector);
            await chrome.storage.local.set({ suspiciousMarkers });
        }
    },

    async getDiscoveredMarkers() {
        const { discoveredMarkers = [] } = await chrome.storage.local.get(['discoveredMarkers']);
        const { suspiciousMarkers = [] } = await chrome.storage.local.get(['suspiciousMarkers']);
        
        // Filter out any markers that have been penalized
        return discoveredMarkers.filter(m => !suspiciousMarkers.includes(m));
    }
};

if (typeof window === 'undefined') {
    // Export for background script if node-like environment
    module.exports = BrainBridge;
}
