// Logic for AdsFriendly Options Page

const whitelistEl = document.getElementById('whitelist-list');
const blacklistEl = document.getElementById('blacklist-list');
const resetBtn = document.getElementById('btn-reset');

async function loadLists() {
    const { whitelist = [], blacklist = [], blockedLogs = [] } = await chrome.storage.local.get(['whitelist', 'blacklist', 'blockedLogs']);
    
    renderList(whitelist, whitelistEl, 'WHITELIST');
    renderList(blacklist, blacklistEl, 'BLACKLIST');
    renderCustomRules();
    renderNavigationLogs(blockedLogs);
    renderLearnedPaths();
}

const renderNavigationLogs = (logs) => {
    const container = document.getElementById('blocked-logs-container');
    if (logs.length === 0) {
        container.innerHTML = '<div class="empty-msg">Clean history. No suspicious navigations blocked recently.</div>';
        return;
    }

    container.innerHTML = logs.map(log => `
        <div class="item" style="flex-direction: column; align-items: flex-start; gap: 4px;">
            <div style="font-size: 0.8rem; color: #fbd38d; font-weight: bold;">Blocked Navigation</div>
            <div style="font-family: monospace; font-size: 0.75rem; word-break: break-all;">Target: ${log.url}</div>
            <div style="font-size: 0.7rem; color: #64748b;">Source: ${log.source} • ${new Date(log.timestamp).toLocaleString()}</div>
        </div>
    `).join('');
};

const renderLearnedPaths = async () => {
    const container = document.getElementById('learned-paths-container');
    const allStorage = await chrome.storage.local.get(null);
    const pulseKeys = Object.keys(allStorage).filter(key => key.startsWith('p:'));

    if (pulseKeys.length === 0) {
        container.innerHTML = '<div class="empty-msg">No learned workflows yet.</div>';
        return;
    }

    container.innerHTML = pulseKeys.map(key => {
        const path = allStorage[key];
        const trustBadge = path.isManual ? 
            `<span style="background: rgba(168, 85, 247, 0.2); color: #a855f7; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: bold;">MANUAL TRUST</span>` : 
            `<span style="background: rgba(34, 197, 94, 0.2); color: #22c55e; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem;">Natural Habit (${path.visits} visits)</span>`;
            
        return `
            <div class="item">
                <div>
                    <div style="font-size: 0.85rem; font-weight: bold;">${path.source} → ${path.target}</div>
                    <div style="margin-top: 4px;">${trustBadge}</div>
                </div>
            </div>
        `;
    }).join('');
};

const renderCustomRules = () => {
    const container = document.getElementById('custom-rules-container');
    if (!container) return;
    chrome.storage.local.get('userCustomRules', (result) => {
        const rules = result.userCustomRules || {};
        const hostnames = Object.keys(rules);

        if (hostnames.length === 0) {
            container.innerHTML = `<p style="color: #64748b; font-size: 0.8rem; font-style: italic;">No custom rules found yet.</p>`;
            return;
        }

        container.innerHTML = hostnames.map(hostname => {
            const domainRules = rules[hostname];
            const detailsHtml = domainRules.map((rule, idx) => {
                const selector = typeof rule === 'string' ? rule : rule.selector;
                const fingerprint = (typeof rule === 'object' && rule.fingerprint) ? 
                    JSON.stringify(rule.fingerprint).replace(/"/g, '') : 'Simple Selector';
                return `
                    <div style="padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.05); font-size: 0.75rem;">
                        <span style="color: #60a5fa;">#${idx+1}:</span> <code style="background: rgba(0,0,0,0.2); padding: 2px 4px;">${selector}</code>
                        <div style="color: #64748b; margin-top: 2px; font-style: italic;">Signal: ${fingerprint}</div>
                    </div>
                `;
            }).join('');

            return `
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); padding: 12px; border-radius: 12px; margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: bold; font-size: 0.95rem; color: #e2e8f0;">${hostname}</div>
                            <div style="font-size: 0.75rem; color: #64748b;">${domainRules.length} technical rules active</div>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="toggle-details" style="background: rgba(255,255,255,0.05); color: #94a3b8; border: 1px solid rgba(255,255,255,0.1); padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem;">Show Details</button>
                            <button class="btn-delete-rule" data-hostname="${hostname}" style="background: rgba(239, 68, 68, 0.1); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.2); padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem;">Reset Site</button>
                        </div>
                    </div>
                    <div class="details-pane" style="display: none; margin-top: 12px; padding-top: 8px;">
                        ${detailsHtml}
                    </div>
                </div>
            `;
        }).join('');

        // Listeners for Delete
        document.querySelectorAll('.btn-delete-rule').forEach(btn => {
            btn.onclick = async (e) => {
                const hostname = e.target.getAttribute('data-hostname');
                if(confirm(`Wipe all memory for ${hostname}?`)) {
                    const currentRules = rules[hostname];
                    const { siteResetHistory = {} } = await chrome.storage.local.get('siteResetHistory');
                    
                    // Archive the "mistake"
                    siteResetHistory[hostname] = {
                        oldRules: currentRules,
                        timestamp: Date.now()
                    };

                    delete rules[hostname];
                    await chrome.storage.local.set({ 
                        userCustomRules: rules,
                        siteResetHistory: siteResetHistory
                    });
                    renderCustomRules();
                }
            };
        });

        // Listeners for Toggle
        document.querySelectorAll('.toggle-details').forEach(btn => {
            btn.onclick = (e) => {
                const pane = e.target.closest('div').parentElement.nextElementSibling;
                const isHidden = pane.style.display === 'none';
                pane.style.display = isHidden ? 'block' : 'none';
                e.target.textContent = isHidden ? 'Hide Details' : 'Show Details';
            };
        });
    });
};

function renderList(list, element, type) {
    if (list.length === 0) {
        element.innerHTML = '<div class="empty-msg">No sites added yet</div>';
        return;
    }

    element.innerHTML = '';
    list.forEach(domain => {
        const item = document.createElement('div');
        item.className = 'item';
        item.innerHTML = `
            <span>${domain}</span>
            <button class="btn-delete" data-domain="${domain}" data-type="${type}">
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
        `;
        element.appendChild(item);
    });

    element.querySelectorAll('.btn-delete').forEach(btn => {
        btn.onclick = async () => {
            const ruleOrDomain = btn.getAttribute('data-domain');
            const typ = btn.getAttribute('data-type').toLowerCase();
            const data = await chrome.storage.local.get([typ]);
            const updated = data[typ].filter(d => d !== ruleOrDomain);
            await chrome.storage.local.set({ [typ]: updated });
            loadLists();
        };
    });
}

resetBtn.onclick = async () => {
    if (confirm('DANGER: Wipe EVERYTHING? (Whitelist, Rules, AI Memory, History)')) {
        await chrome.storage.local.clear();
        await chrome.storage.local.set({ isEnabled: true, blockedCount: 0 });
        chrome.action.setBadgeText({ text: '' });
        loadLists();
    }
};

// Feedback Logic
const feedbackForm = document.getElementById('feedback-form');
const fbStatus = document.getElementById('fb-status');
const fbSubmit = document.getElementById('fb-submit');
const COOLDOWN_MS = 3600000;

if (feedbackForm) {
    feedbackForm.onsubmit = async (e) => {
        e.preventDefault();
        const body = document.getElementById('fb-body').value.trim();
        const rating = document.querySelector('input[name="rating"]:checked').value;

        if (body.length < 1) {
            fbStatus.style.display = 'block';
            fbStatus.style.color = 'var(--danger)';
            fbStatus.textContent = "Vui lòng nhập nội dung góp ý.";
            return;
        }

        if (!confirm("Gửi góp ý của bạn?")) return;

        const { lastFeedbackTime = 0 } = await chrome.storage.local.get(['lastFeedbackTime']);
        if (Date.now() - lastFeedbackTime < COOLDOWN_MS) {
            fbStatus.style.display = 'block';
            fbStatus.textContent = `Vui lòng đợi một chút trước khi gửi lại.`;
            return;
        }
        
        // RESTORED: Production Cloudflare Worker URL
        const WORKER_URL = "https://telegarmworker.ngoquangvy97.workers.dev/adsfriendly";
        
        fbSubmit.disabled = true;
        fbStatus.style.display = 'block';
        fbStatus.style.color = '#94a3b8';
        fbStatus.textContent = "Đang gửi...";

        try {
            await fetch(WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body, rating: parseInt(rating) })
            });
            fbStatus.style.color = '#22c55e';
            fbStatus.textContent = "Gửi thành công! Cảm ơn bạn.";
            feedbackForm.reset();
            await chrome.storage.local.set({ lastFeedbackTime: Date.now() });
        } catch (err) {
            fbStatus.style.color = 'var(--danger)';
            fbStatus.textContent = "Lỗi: " + err.message;
        } finally {
            fbSubmit.disabled = false;
        }
    };
}

loadLists();

loadLists();
