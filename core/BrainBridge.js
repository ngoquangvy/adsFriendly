/**
 * AdsFriendly: BrainBridge (v5.0 - Server-Ready Architecture)
 * The authoritative bridge between client sensors and the underlying intelligence.
 * Orchestrates Data Intake, API Gateway Sync, and Rules Routing.
 */

// Cấp quyền gọi qua API Gateway nếu được inject chung môi trường
const gateway = typeof APIGateway !== 'undefined' ? APIGateway : null;

const BrainBridge = {
    mode: 'HYBRID',
    userId: 'anonymous', // Sẽ được gán sau khi có hệ thống Login
    
    // --- LỚP 1: LƯU TRỮ TRẠNG THÁI (State Memory) ---
    personalRules: {},     // Rule tự cấu hình/học của User (Offline)
    globalPatterns: [],    // Rule tải từ Server (Online)
    learnedBuffer: [],     // Hàng đợi phân tích

    async init() {
        console.log('[AdsFriendly BrainBridge] Khởi tạo mô hình Client-Server (Hybrid) v5.0...');
        
        // 1. Phục hồi trạng thái Local
        const localData = await chrome.storage.local.get(['userCustomRules', 'globalAdPatterns', 'personalOverrides']);
        this.personalRules = localData.personalOverrides || {};
        this.globalPatterns = localData.globalAdPatterns || [];

        // 2. Đồng bộ hóa với Server theo chu kỳ (Cloud Sync)
        this.syncWithCloud();
    },

    // --- LỚP 2: BỘ ĐIỀU PHỐI ĐỒNG BỘ (Gateway Adapter) ---
    async syncWithCloud() {
        if (!gateway) return;
        
        console.log('[BrainBridge] Yêu cầu lấy Global Rules từ Server...');
        const cloudData = await gateway.fetchCloudRules(this.userId);
        
        if (cloudData && cloudData.globalPatterns) {
            this.globalPatterns = cloudData.globalPatterns;
            // Chỉ lưu lại Cache Cloud xuống HDD nếu data hợp lệ (Đề phòng server trả lỗi)
            await chrome.storage.local.set({ globalAdPatterns: this.globalPatterns });
            console.log('[BrainBridge] Đã Cache Cloud Rules thành công.');
        }
    },

    // --- LỚP 3: BỘ PHÂN TÍCH (Standardizer & Engine) ---
    standardize(selector) {
        if (!selector) return null;
        let clean = selector.replace(/-\d+$/, '-*');
        clean = clean.replace(/:\d+$/, ':*');
        return clean;
    },

    // --- LỚP 4: CẢM BIẾN ĐẦU VÀO TỪ DOM & MẠNG (Sensor Intake) ---
    async recordDecision(entry) {
        if (!chrome.runtime || !chrome.runtime.id) return;
        const logEntry = { ...entry, timestamp: Date.now(), userId: this.userId };

        // A. Cố gắng đẩy Telemetry Decision lên Lò Server AI
        if (gateway) {
            gateway.submitTelemetry({
                type: 'DECISION_LOG',
                provider_type: 'UI_HEURISTIC', // DOM-based heuristic detection
                data: logEntry
            });
        }

        // B. Lưu Offline Fallback như cũ (v2.0 behavior)
        const { neuroLogs = [] } = await chrome.storage.local.get(['neuroLogs']);
        neuroLogs.unshift(logEntry);
        if (neuroLogs.length > 50) neuroLogs.length = 50;
        await chrome.storage.local.set({ neuroLogs });
        
        if (entry.final_confidence > 0.9) {
            this.promoteToBuffer(entry);
        }
    },

    async recordIntelligence(data) {
        if (!chrome.runtime || !chrome.runtime.id) return;

        // Bắn Network Genomes (m3u8, vast) ra tầng mây AI
        if (gateway) {
            gateway.submitTelemetry({
                type: 'AD_GENOME_HARVEST',
                provider_type: data.provider || 'JSON_DEEP_SCAN', // Map to HLS or JSON
                data: { ...data, timestamp: Date.now(), userId: this.userId }
            });
        }

        // Tạm sao lưu dạng Local nếu Server sập
        if (data.type === 'AD_GENOME_HARVEST') {
            const { adGenomes = [] } = await chrome.storage.local.get(['adGenomes']);
            adGenomes.unshift(data.genome);
            if (adGenomes.length > 100) adGenomes.length = 100;
            await chrome.storage.local.set({ adGenomes });
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
        
        // Loại bỏ các marker đã bị dán nhãn phạt
        return discoveredMarkers.filter(m => !suspiciousMarkers.includes(m));
    }
};

if (typeof window === 'undefined') {
    module.exports = BrainBridge;
}
