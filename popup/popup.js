// Logic for Smart BlockAd Popup

// Link UI elements
const blockedCountEl = document.getElementById('blocked-count');
const statusToggle = document.getElementById('status-toggle');
const inPageToggle = document.getElementById('friendly-mode-toggle');

// Load initial state from storage
chrome.storage.local.get(['blockedCount', 'isEnabled', 'friendlyMode'], (result) => {
    if (result.blockedCount !== undefined) {
        blockedCountEl.textContent = result.blockedCount;
    }
    
    // Default global to true, friendly to true
    statusToggle.checked = result.isEnabled !== false;
    inPageToggle.checked = result.friendlyMode !== false;
});

// Handle global toggle changes
statusToggle.addEventListener('change', () => {
    const isEnabled = statusToggle.checked;
    chrome.storage.local.set({ isEnabled });
    chrome.runtime.sendMessage({ type: 'TOGGLE_STATUS', isEnabled });
});

// Handle friendly mode toggle changes (Inverted Logic)
inPageToggle.addEventListener('change', () => {
    const friendlyMode = inPageToggle.checked;
    chrome.storage.local.set({ friendlyMode });
    chrome.runtime.sendMessage({ type: 'TOGGLE_FRIENDLY', enabled: friendlyMode });
});

// Handle settings button
document.getElementById('open-settings').onclick = () => {
    chrome.runtime.openOptionsPage();
};

// Optionally: Periodically poll for updated count
setInterval(() => {
    chrome.storage.local.get(['blockedCount'], (result) => {
        if (result.blockedCount !== undefined) {
            blockedCountEl.textContent = result.blockedCount;
        }
    });
}, 1000);
