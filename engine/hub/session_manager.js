/**
 * Session Manager (Interaction Lifecycle)
 * Role: Manage user interactions, generate & maintain interactionId
 * Responsibilities:
 *   - Generate & track session/interaction IDs
 *   - Monitor click timing
 *   - Provide context to radar (as read-only reference)
 */

window.__V_SESSION = {
    sessionId: 'session-' + Math.random().toString(36).slice(2),
    interactionId: null,
    lastInteractionTime: Date.now(),
    lastClickTime: null,
    clickHistory: [],

    /**
     * Start new interaction (on user click)
     * ✅ NOW QUEUE-AWARE: Interacts with BrainBridge event queue
     */
    startInteraction(metadata = {}) {
        this.interactionId = 'int-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        this.lastInteractionTime = Date.now();
        this.lastClickTime = Date.now();

        // Global reference for radar to read
        window.__V_INTERACTION_ID = this.interactionId;

        // ✅ QUEUE AWARENESS: Track if BrainBridge is still syncing
        const bridge = window.Engine?.brainBridge;
        const isSynced = bridge?._isSynced ?? true;
        const queueSize = bridge?._eventQueue?.length ?? 0;

        // Track history
        this.clickHistory.push({
            interactionId: this.interactionId,
            timestamp: this.lastInteractionTime,
            url: metadata.url || null,
            target: metadata.target || null,
            bridgeSyncStatus: isSynced ? 'SYNCED' : 'WAITING_SYNC',
            bridgeQueueSize: queueSize
        });

        console.log(
            `%c[SessionMgr] New interaction: ${this.interactionId} (Bridge: ${isSynced ? 'READY' : 'SYNCING'}, Queue: ${queueSize})`,
            'color:#8b5cf6;font-weight:bold;'
        );

        return this.interactionId;
    },

    /**
     * Get current context (read-only for components)
     */
    getContext() {
        return {
            sessionId: this.sessionId,
            interactionId: this.interactionId,
            lastInteractionTime: this.lastInteractionTime,
            interactionAge: Date.now() - (this.lastInteractionTime || 0)
        };
    },

    /**
     * Clear interaction (on page unload or session reset)
     */
    clearInteraction() {
        this.interactionId = null;
        window.__V_INTERACTION_ID = null;
    }
};

// ⚡ INITIALIZE: Hook click in capture phase (BEFORE radar)
if (!window.__V_SESSION_MANAGER_ACTIVE__) {
    window.__V_SESSION_MANAGER_ACTIVE__ = true;

    window.addEventListener('click', (e) => {
        const a = e.target.closest('a');
        if (a?.href) {
            window.__V_SESSION.startInteraction({
                url: a.href,
                target: a.innerText?.slice(0, 50) || ''
            });
        }
    }, { capture: true, passive: true });

    console.log('%c[SessionManager ACTIVE]', 'color:#8b5cf6;font-weight:bold;');
}
