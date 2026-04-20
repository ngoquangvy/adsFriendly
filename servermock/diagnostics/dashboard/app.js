
/**
 * Vanguard Diagnostic Dashboard - Core Logic
 */

const STATE = {
    allEvents: [],
    normalizedEvents: [],
    currentView: 'overview',
    selectedDomain: null
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initModal();
    initRefresh();
    
    // Initial Load with Real Data
    fetchData();
});

function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item[data-view]');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            STATE.currentView = item.getAttribute('data-view');
            STATE.selectedDomain = null; // Reset domain filter when switching views
            renderView();
        });
    });
}

function initModal() {
    const overlay = document.getElementById('modal-overlay');
    const closeBtn = document.getElementById('close-modal');
    
    closeBtn.addEventListener('click', () => {
        overlay.style.display = 'none';
    });
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.style.display = 'none';
    });
}

function initRefresh() {
    document.getElementById('refresh-btn').addEventListener('click', () => {
        fetchData();
    });
}

// --- Data Normalization (Vanguard Logic) ---
function normalizeLog(l) {
    const data = l.data ?? l;
    
    // --- 1. Canonical Schema Detection (v14.0 - Training Ready) ---
    if (data.schema_v === '14.0') {
        const domain = (data.domain ?? '').toLowerCase().trim();
        const label = data.label_pred ?? data.label ?? '';
        
        if (!domain || domain === 'undefined') return null;
        if (!label || label === 'undefined') return null;

        let badgeClass = label.toLowerCase();
        if (label === 'HIGH_RISK') badgeClass = 'risk';
        if (label === 'MEDIA_PASS') badgeClass = 'media';

        return {
            url: data.url ?? 'unknown',
            domain,
            label,
            label_true: data.label_true ?? 'UNKNOWN',
            badgeClass,
            score: data.score ?? 0,
            confidence: data.confidence ?? 0,
            action: data.action ?? 'ALLOW',
            features: data.features ?? {},
            context: data.context ?? {},
            raw_signal: {
                method: data.raw?.method ?? 'GET',
                type: data.raw?.type ?? 'unknown',
                isError: data.raw?.isError || false
            },
            timestamp: data.timestamp ?? Date.now(),
            raw: l
        };
    }

    // --- 2. Schema v13.8 Fallback ---
    if (data.schema_v === '13.8') {
        const domain = (data.domain ?? '').toLowerCase().trim();
        const label = data.label ?? '';
        
        if (!domain || domain === 'undefined') return null;
        if (!label || label === 'undefined') return null;

        let badgeClass = label.toLowerCase();
        if (label === 'HIGH_RISK') badgeClass = 'risk';
        if (label === 'MEDIA_PASS') badgeClass = 'media';

        return {
            url: data.url ?? 'unknown',
            domain,
            label,
            badgeClass,
            score: data.score ?? 0,
            confidence: data.confidence ?? 0,
            action: data.action ?? 'ALLOW',
            features: data.features ?? {},
            context: data.context ?? {},
            timestamp: data.timestamp ?? Date.now(),
            raw: l
        };
    }

    // --- 2. Legacy Fallback Logic ---
    const final = data.final ?? data;
    const trace = data.trace ?? {};
    const decision = final.decision ?? data.decision ?? {};
    const context = final.context ?? data.context ?? {};

    const domain = (final.domain ?? trace.event?.domain ?? data.domain ?? '').toLowerCase().trim();
    const label = final.label ?? decision.label ?? data.label ?? '';

    if (!domain || domain === 'undefined') return null;
    if (!label || label === 'undefined') return null;

    let badgeClass = label.toLowerCase();
    if (label === 'HIGH_RISK') badgeClass = 'risk';
    if (label === 'MEDIA_PASS') badgeClass = 'media';

    return {
        url: final.url ?? data.url ?? 'unknown',
        domain,
        label,
        badgeClass,
        score: final.score ?? decision.score ?? data.score ?? 0,
        confidence: final.confidence ?? decision.confidence ?? data.confidence ?? 0,
        action: final.action ?? decision.action ?? 'ALLOW',
        features: trace.features ?? final.features ?? data.features ?? {},
        context: context,
        timestamp: final.timestamp ?? data.timestamp ?? Date.now(),
        raw: l
    };
}

// --- API Connector ---
async function fetchData() {
    const btn = document.getElementById('refresh-btn');
    btn.textContent = '⌛ Syncing...';
    btn.disabled = true;

    try {
        const response = await fetch('http://localhost:3000/dataset');
        if (!response.ok) throw new Error('API unreachable');
        
        const data = await response.json();
        const initialCount = data.length;
        
        STATE.allEvents = data;
        STATE.normalizedEvents = data.map(normalizeLog).filter(Boolean);
        
        const droppedCount = initialCount - STATE.normalizedEvents.length;
        console.log(`[Dashboard] 📡 Synced ${STATE.normalizedEvents.length} events. (Dropped ${droppedCount} invalid logs)`);
        renderView();
    } catch (e) {
        console.error('[Dashboard] API Error:', e);
        alert('Failed to sync data. Ensure Telemetry Server is running on port 3000.');
    } finally {
        btn.textContent = '↻ Sync Data';
        btn.disabled = false;
    }
}

// --- Views Rendering ---
function renderView() {
    const container = document.getElementById('content-area');
    const title = document.getElementById('view-title');
    container.innerHTML = '';
    
    switch (STATE.currentView) {
        case 'overview':
            title.textContent = 'Dashboard Overview';
            renderOverview(container);
            break;
        case 'explorer':
            title.textContent = STATE.selectedDomain ? `Explorer: ${STATE.selectedDomain}` : 'Domain Explorer';
            renderExplorer(container);
            break;
        case 'mismatches':
            title.textContent = 'Error Detection';
            renderMismatches(container);
            break;
        case 'inspector':
            title.textContent = 'Raw Data Inspector';
            renderInspector(container);
            break;
    }
}

function renderOverview(container) {
    const stats = {
        total: STATE.normalizedEvents.length,
        safe: STATE.normalizedEvents.filter(e => e.label === 'SAFE').length,
        risk: STATE.normalizedEvents.filter(e => e.label === 'HIGH_RISK').length,
        media: STATE.normalizedEvents.filter(e => e.label === 'MEDIA_PASS').length
    };
    
    const rate = ((stats.risk / stats.total) * 100).toFixed(1);

    container.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Total Events</div>
                <div class="stat-value">${stats.total}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">HIGH_RISK Detection</div>
                <div class="stat-value" style="color: var(--danger)">${stats.risk}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">SAFE Events</div>
                <div class="stat-value" style="color: var(--accent)">${stats.safe}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Detection Rate</div>
                <div class="stat-value">${rate}%</div>
            </div>
        </div>

        <h3 style="margin: 1.5rem 0 1rem 0; color: var(--danger)">🔥 Priority Detections (Last 5)</h3>
        <div class="table-container" style="margin-bottom: 2rem; border-color: var(--danger)">
            <table>
                <thead>
                    <tr><th>Domain</th><th>Detection</th><th>Score</th><th>Flag</th><th>Action</th></tr>
                </thead>
                <tbody>
                    ${STATE.normalizedEvents.filter(e => e.label === 'HIGH_RISK').slice().reverse().slice(0, 5).map(e => `
                        <tr style="background: rgba(255, 71, 87, 0.05)">
                            <td><b>${e.domain}</b></td>
                            <td><span class="badge badge-risk">${e.label}</span></td>
                            <td>${e.score.toFixed(2)}</td>
                            <td><small>${e.raw.data?.flags?.[0] || 'N/A'}</small></td>
                            <td><button onclick="inspectEvent(${STATE.normalizedEvents.indexOf(e)})" style="color:var(--danger)">Inspect</button></td>
                        </tr>
                    `).join('') || '<tr><td colspan="5" style="text-align:center; opacity:0.5">No high-risk events in current dataset</td></tr>'}
                </tbody>
            </table>
        </div>
        
        <h3 style="margin-bottom: 1rem">All Recent Activity</h3>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Domain</th>
                        <th>Status</th>
                        <th>Score</th>
                        <th>Timestamp</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${STATE.normalizedEvents.slice().reverse().slice(0, 50).map(e => `
                        <tr>
                            <td>${e.domain}</td>
                            <td>
                                <span class="badge badge-${e.badgeClass}">${e.label}</span>
                                <small style="display:block; opacity:0.6; margin-top:2px;">Truth: ${e.label_true || 'UNKNOWN'}</small>
                            </td>
                            <td>${e.score.toFixed(2)}</td>
                            <td>${new Date(e.timestamp || Date.now()).toLocaleTimeString()}</td>
                            <td><button onclick="inspectEvent(${STATE.normalizedEvents.indexOf(e)})" style="background:none; border:none; color:var(--accent); cursor:pointer;">Inspect</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderExplorer(container) {
    if (STATE.selectedDomain) {
        const domainEvents = STATE.normalizedEvents.filter(e => e.domain === STATE.selectedDomain);
        container.innerHTML = `
            <button onclick="STATE.selectedDomain=null; renderView();" style="margin-bottom:1rem; background:none; border:1px solid var(--border); color:white; padding:5px 10px; border-radius:5px; cursor:pointer;">← Back to Domains</button>
            <div class="table-container">
                <table>
                    <thead>
                        <tr><th>URL</th><th>Label</th><th>Score</th></tr>
                    </thead>
                    <tbody>
                        ${domainEvents.map(e => `
                            <tr>
                                <td title="${e.url}">${e.url.substring(0, 80)}...</td>
                                <td><span class="badge badge-${e.badgeClass}">${e.label}</span></td>
                                <td>${e.score.toFixed(2)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        return;
    }

    const domainMap = {};
    STATE.normalizedEvents.forEach(e => {
        domainMap[e.domain] = (domainMap[e.domain] || 0) + 1;
    });
    
    const sortedDomains = Object.entries(domainMap).sort((a,b) => b[1] - a[1]);

    container.innerHTML = `
        <div class="stats-grid">
            ${sortedDomains.map(([domain, count]) => `
                <div class="stat-card" style="cursor:pointer" onclick="selectDomain('${domain}')">
                    <div class="stat-label">${domain}</div>
                    <div class="stat-value">${count} reqs</div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderMismatches(container) {
    const fn = STATE.normalizedEvents.filter(l => {
        const isAd = l.label_true === 'ADS';
        return l.label === 'SAFE' && isAd;
    });
    const fp = STATE.normalizedEvents.filter(l => {
        const isAd = l.label_true === 'ADS';
        return l.label === 'HIGH_RISK' && !isAd;
    });

    container.innerHTML = `
        <h3 style="margin-bottom:1rem">False Negatives (SAFE but Ad)</h3>
        <div class="table-container" style="margin-bottom:2rem">
            <table>
                <thead><tr><th>URL</th><th>Domain</th><th>Score</th></tr></thead>
                <tbody>
                    ${fn.length > 0 ? fn.map(e => `<tr><td>${e.url.substring(0,60)}...</td><td>${e.domain}</td><td>${e.score}</td></tr>`).join('') : '<tr><td colspan="3">No issues found</td></tr>'}
                </tbody>
            </table>
        </div>

        <h3 style="margin-bottom:1rem">False Positives (HIGH_RISK but not Ad)</h3>
        <div class="table-container">
            <table>
                <thead><tr><th>URL</th><th>Domain</th><th>Score</th></tr></thead>
                <tbody>
                    ${fp.length > 0 ? fp.map(e => `<tr><td>${e.url.substring(0,60)}...</td><td>${e.domain}</td><td>${e.score}</td></tr>`).join('') : '<tr><td colspan="3">No issues found</td></tr>'}
                </tbody>
            </table>
        </div>
    `;
}

function renderInspector(container) {
    container.innerHTML = `
        <div class="table-container">
            <table>
                <thead><tr><th>Event</th><th>Summary</th><th>Timestamp</th><th>Action</th></tr></thead>
                <tbody>
                    ${STATE.normalizedEvents.map((e, i) => `
                        <tr>
                            <td>#${i+1}</td>
                            <td>${e.label} | ${e.domain}</td>
                            <td>${new Date(e.raw.timestamp || Date.now()).toLocaleString()}</td>
                            <td><button onclick="inspectEvent(${i})" style="color:var(--accent)">View JSON</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// --- Interaction Helpers ---
window.selectDomain = (domain) => {
    STATE.selectedDomain = domain;
    renderView();
};

window.inspectEvent = (index) => {
    const e = STATE.normalizedEvents[index];
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    
    content.textContent = JSON.stringify(e.raw, null, 2);
    overlay.style.display = 'flex';
};
