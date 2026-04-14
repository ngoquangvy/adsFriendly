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
document.getElementById('settings-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
});

// Handle Magic Wand (Zapper)
document.getElementById('magic-wand-btn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
        try {
            chrome.tabs.sendMessage(tab.id, { type: 'START_PICKER' });
            window.close(); // Close popup to let user interact with the page
        } catch (err) {
            console.error('Could not send message to content script:', err);
        }
    }
});

// Optionally: Periodically poll for updated count
setInterval(() => {
    chrome.storage.local.get(['blockedCount'], (result) => {
        if (result.blockedCount !== undefined) {
            blockedCountEl.textContent = result.blockedCount;
        }
    });
}, 1000);
