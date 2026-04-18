/**
 * Lớp cổng giao tiếp API (Client API Gateway)
 * Mục đích: Tháo gỡ các lệnh truy cập trực tiếp (chrome.storage) rải rác trên giao diện.
 * Biến Client thành một trạm Radar chỉ thu - phát sóng lên máy chủ.
 */
window.APIGateway = {
    // Địa chỉ Server AI tương lai của bạn (VD: Node.js hoặc Python FastAPI)
    serverUrl: 'http://localhost:3000',

    async _simulateLatency(ms = 300) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * Phương thức GET: Kéo dữ liệu thuật toán được Server tối ưu
     * Hỗ trợ chuẩn bị phân quyền User Đăng nhập sau này
     */
    async fetchCloudRules(userToken = null) {
        try {
            // Sau này dùng fetch(`${this.serverUrl}/rules`)
            await this._simulateLatency(500); // Simulate API call

            // Giả lập Server trả JSON về (Sau này sẽ lấy từ Nodejs + MongoDB)
            const mockResponse = {
                globalPatterns: [
                    { type: "video_source_marker", value: "doubleclick.net" },
                    { type: "video_source_marker", value: "innovid.com" }
                ],
                trustScores: {
                    "youtube.com": 0.9,
                    "phimmoi.net": 0.1
                }
            };
            //console.log('[API Gateway] 🌐 Cập nhật Data Cloud v2.0 thành công!');
            return mockResponse;
        } catch (err) {
            console.error('[API Gateway] Mạng lõm, gọi Server thất bại:', err);
            return null; // BrainBridge sẽ tự lo liệu fallback
        }
    },

    // Unique session ID for tracking telemetry across a single page session
    sessionId: Math.random().toString(36).substring(2, 15),

    /**
     * Phương thức POST: Gửi bằng chứng thông qua Cầu nối Messaging (Vượt rào CSP)
     * v3.9: Hỗ trợ Payload chuẩn hóa
     */
    async submitTelemetry(payload) {
        try {
            // Nhóm Định danh (Identity)
            const identity = {
                site_domain: window.location.hostname,
                session_id: this.sessionId,
                provider_type: payload.provider_type || 'UNKNOWN'
            };

            const fullPayload = {
                identity,
                type: payload.type,
                data: payload.data,
                timestamp: Date.now()
            };

            // 🚀 DEEP DEBUG: Log cửa ra tại Engine
            console.log('[TELEMETRY] sending', fullPayload);

            // 🚀 MESSAGING TUNNEL: Ném tin nhắn qua cho Loader (Content Script)
            // Cách này giúp vượt qua rào cản CSP của YouTube
            window.postMessage({
                source: 'adsfriendly-engine',
                type: 'SUBMIT_TELEMETRY',
                payload: fullPayload
            }, "*");

            return { success: true, tunneled: true };
        } catch (err) {
            console.warn('[API Gateway] ❌ Tunneling failed:', err.message);
            return { success: false, error: err.message };
        }
    }
};

// Dùng cho ServiceWorker (Background)
if (typeof window === 'undefined') {
    module.exports = APIGateway;
}
