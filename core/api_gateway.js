/**
 * Lớp cổng giao tiếp API (Client API Gateway)
 * Mục đích: Tháo gỡ các lệnh truy cập trực tiếp (chrome.storage) rải rác trên giao diện.
 * Biến Client thành một trạm Radar chỉ thu - phát sóng lên máy chủ.
 */
const APIGateway = {
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
            console.log('[API Gateway] 🌐 Cập nhật Data Cloud v2.0 thành công!');
            return mockResponse;
        } catch (err) {
            console.error('[API Gateway] Mạng lõm, gọi Server thất bại:', err);
            return null; // BrainBridge sẽ tự lo liệu fallback
        }
    },

    // Unique session ID for tracking telemetry across a single page session
    sessionId: Math.random().toString(36).substring(2, 15),

    /**
     * Phương thức POST: Nạp các bằng chứng (Genome) do màn hình DOM bắt được lên lò luyện AI.
     * v3.9: Hỗ trợ Payload chuẩn hóa (Identity + Content)
     */
    async submitTelemetry(payload) {
        try {
            // Nhóm Định danh (Identity) - Tự động bổ sung nếu thiếu
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

            // Gửi dữ liệu thực tế về Mock Server
            const response = await fetch(`${this.serverUrl}/telemetry`, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fullPayload)
            });

            const result = await response.json();
            console.log(`[API Gateway] 📡 Upload Success [${identity.provider_type}] -> Session: ${identity.session_id}`);
            return result;
        } catch (err) {
            console.warn('[API Gateway] ❌ Gửi Telemetry thất bại (Có thể do Mock Server chưa chạy):', err.message);
            return { success: false, error: err.message };
        }
    }
};

// Dùng cho ServiceWorker (Background)
if (typeof window === 'undefined') {
    module.exports = APIGateway;
}
