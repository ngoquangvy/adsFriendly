// Logic for AdsFriendly Options Page

const whitelistEl = document.getElementById('whitelist-list');
const blacklistEl = document.getElementById('blacklist-list');
const resetBtn = document.getElementById('btn-reset');

async function loadLists() {
    const { whitelist = [], blacklist = [] } = await chrome.storage.local.get(['whitelist', 'blacklist']);
    
    renderList(whitelist, whitelistEl, 'WHITELIST');
    renderList(blacklist, blacklistEl, 'BLACKLIST');
}

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

    // Add listeners to delete buttons
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
    if (confirm('Are you sure you want to reset all data (Whitelist, Blacklist, and Block count)?')) {
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

const COOLDOWN_MS = 3600000; // 1 giờ (60 * 60 * 1000)


if (feedbackForm) {
    feedbackForm.onsubmit = async (e) => {
        e.preventDefault();
        
        const body = document.getElementById('fb-body').value.trim();
        const rating = document.querySelector('input[name="rating"]:checked').value;

        if (body.length < 1) { // Only block if completely empty
            fbStatus.style.display = 'block';
            fbStatus.style.color = 'var(--danger)';
            fbStatus.textContent = "Please enter your feedback.";
            return;
        }

        // Confirmation dialog
        if (!confirm("Are you sure you want to send this feedback?")) {
            return;
        }

        // Check cooldown ONLY when clicking send
        const { lastFeedbackTime = 0 } = await chrome.storage.local.get(['lastFeedbackTime']);
        const now = Date.now();
        if (now - lastFeedbackTime < COOLDOWN_MS) {
            const remainingMin = Math.ceil((COOLDOWN_MS - (now - lastFeedbackTime)) / 60000);
            fbStatus.style.display = 'block';
            fbStatus.style.color = '#ff9800';
            fbStatus.textContent = `You sent a feedback recently. Please wait ${remainingMin} more minutes.`;
            return;
        }
        
        // CONFIG: Replace this with your actual Cloudflare Worker URL after deployment
        const WORKER_URL = "https://your-dedicated-worker.workers.dev/adsfriendly";

        if (WORKER_URL.includes("your-feedback-worker")) {
            fbStatus.style.display = 'block';
            fbStatus.style.color = '#ff9800';
            fbStatus.textContent = "Note: You need to replace WORKER_URL in options.js with your actual URL!";
            return;
        }


        fbSubmit.disabled = true;
        fbSubmit.textContent = "Sending...";
        fbStatus.style.display = 'block';
        fbStatus.style.color = '#94a3b8';
        fbStatus.textContent = "Sending your feedback...";

        try {
            const response = await fetch(WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body, rating: parseInt(rating) })
            });

            const result = await response.json();

            if (response.ok) {
                fbStatus.style.color = '#22c55e';
                fbStatus.textContent = "Thank you! Your feedback has been sent successfully.";
                feedbackForm.reset();
                
                // Set cooldown
                await chrome.storage.local.set({ lastFeedbackTime: Date.now() });
            } else {
                throw new Error(result.error || "Sending failed");
            }
        } catch (err) {
            fbStatus.style.color = 'var(--danger)';
            fbStatus.textContent = "Error: " + err.message;
        } finally {
            fbSubmit.disabled = false;
            fbSubmit.textContent = "Send Feedback";
        }
    };
}

loadLists();
