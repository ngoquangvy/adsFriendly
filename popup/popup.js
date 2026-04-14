// Logic for Smart BlockAd Popup

// Link UI elements
const blockedCountEl = document.getElementById('blocked-count');
const statusToggle = document.getElementById('status-toggle');

// Load initial state from storage
chrome.storage.local.get(['blockedCount', 'isEnabled'], (result) => {
    if (result.blockedCount !== undefined) {
        blockedCountEl.textContent = result.blockedCount;
    }
    if (result.isEnabled !== undefined) {
        statusToggle.checked = result.isEnabled;
    } else {
        // Default to enabled
        statusToggle.checked = true;
    }
});

// Handle toggle changes
statusToggle.addEventListener('change', () => {
    const isEnabled = statusToggle.checked;
    chrome.storage.local.set({ isEnabled });
    chrome.runtime.sendMessage({ type: 'TOGGLE_STATUS', isEnabled });
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
