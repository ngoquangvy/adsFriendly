
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
    // 🛠️ Robust Schema Fallback Logic
    const root = l.data ?? l;
    
    // Possibility 1: Full-Context Trace (root.final / root.trace)
    // Possibility 2: Direct wrap (root.decision / root.raw)
    const final = root.final ?? root;
    const trace = root.trace ?? {};
    const decision = final.decision ?? root.decision ?? {};
    const context = final.context ?? root.context ?? {};
    const event = trace.event ?? final.raw ?? root.raw ?? {};

    const label = final.label ?? decision.label ?? root.label ?? 'undefined';
    
    // Map internal labels to CSS-friendly classes
    let badgeClass = label.toLowerCase();
    if (label === 'HIGH_RISK') badgeClass = 'risk';
    if (label === 'MEDIA_PASS') badgeClass = 'media';

    return {
        url: final.url ?? event.url ?? root.url ?? 'unknown',
        domain: (final.domain ?? context.domain ?? root.domain ?? 'unknown').toLowerCase().trim(),
        label: label,
        badgeClass: badgeClass,
        score: final.score ?? decision.score ?? root.score ?? 0,
        confidence: final.confidence ?? decision.confidence ?? root.confidence ?? 0,
        reputation: context.reputation ?? root.reputation ?? 0,
        features: trace.features ?? root.features ?? {},
        context: context,
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
        STATE.allEvents = data;
        STATE.normalizedEvents = data.map(normalizeLog);
        
        console.log(`[Dashboard] 📡 Synced ${data.length} events.`);
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
                    ${STATE.normalizedEvents.slice(0, 15).map(e => `
                        <tr>
                            <td>${e.domain}</td>
                            <td><span class="badge badge-${e.badgeClass}">${e.label}</span></td>
                            <td>${e.score.toFixed(2)}</td>
                            <td>${new Date(e.raw.timestamp || Date.now()).toLocaleTimeString()}</td>
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
        const isAd = l.features?.network?.isAdDomain === true || l.context?.domainClass === 'ads_network';
        return l.label === 'SAFE' && isAd;
    });
    const fp = STATE.normalizedEvents.filter(l => {
        const isAd = l.features?.network?.isAdDomain === true || l.context?.domainClass === 'ads_network';
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
