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
        element.innerHTML = '<div class="empty-msg">Chưa có trang nào</div>';
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
    if (confirm('Bạn có chắc chắn muốn xóa toàn bộ dữ liệu (Whitelist, Blacklist, Số lượng chặn)?')) {
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

if (feedbackForm) {
    feedbackForm.onsubmit = async (e) => {
        e.preventDefault();
        
        // CONFIG: Production Cloudflare Worker URL for AdsFriendly feedback
        const WORKER_URL = "https://telegarmworker.ngoquangvy97.workers.dev/adsfriendly";

        if (WORKER_URL.includes("your-feedback-worker")) {
            fbStatus.style.display = 'block';
            fbStatus.style.color = '#ff9800';
            fbStatus.textContent = "Lưu ý: Bạn cần thay WORKER_URL trong options.js bằng URL thật sau khi deploy Cloudflare Worker!";
            return;
        }

        const title = document.getElementById('fb-title').value;
        const body = document.getElementById('fb-body').value;
        const rating = document.querySelector('input[name="rating"]:checked').value;

        fbSubmit.disabled = true;
        fbSubmit.textContent = "Đang gửi...";
        fbStatus.style.display = 'block';
        fbStatus.style.color = '#94a3b8';
        fbStatus.textContent = "Đang gửi góp ý của bạn...";

        try {
            const response = await fetch(WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, body, rating: parseInt(rating) })
            });

            const result = await response.json();

            if (response.ok) {
                fbStatus.style.color = '#22c55e';
                fbStatus.textContent = "Cảm ơn bạn! Góp ý đã được gửi thành công.";
                feedbackForm.reset();
            } else {
                throw new Error(result.error || "Lỗi gửi góp ý");
            }
        } catch (err) {
            fbStatus.style.color = 'var(--danger)';
            fbStatus.textContent = "Lỗi: " + err.message;
        } finally {
            fbSubmit.disabled = false;
            fbSubmit.textContent = "Gửi góp ý";
        }
    };
}

loadLists();
