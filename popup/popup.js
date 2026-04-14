// Logic for Smart BlockAd Popup

// Link UI elements
const blockedCountEl = document.getElementById('blocked-count');
const inPageToggle = document.getElementById('in-page-toggle');

// Load initial state from storage
chrome.storage.local.get(['blockedCount', 'isEnabled', 'inPageEnabled'], (result) => {
    if (result.blockedCount !== undefined) {
        blockedCountEl.textContent = result.blockedCount;
    }
    
    // Default global to true, in-page to false
    statusToggle.checked = result.isEnabled !== false;
    inPageToggle.checked = result.inPageEnabled === true;
});

// Handle global toggle changes
statusToggle.addEventListener('change', () => {
    const isEnabled = statusToggle.checked;
    chrome.storage.local.set({ isEnabled });
    chrome.runtime.sendMessage({ type: 'TOGGLE_STATUS', isEnabled });
});

// Handle in-page toggle changes (Layer 2)
inPageToggle.addEventListener('change', () => {
    const inPageEnabled = inPageToggle.checked;
    chrome.storage.local.set({ inPageEnabled });
    chrome.runtime.sendMessage({ type: 'TOGGLE_IN_PAGE', enabled: inPageEnabled });
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
