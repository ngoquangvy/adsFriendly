// Logic for Smart BlockAd Popup

// Link UI elements
const blockedCountEl = document.getElementById('blocked-count');
const statusToggle = document.getElementById('status-toggle');
const inPageToggle = document.getElementById('friendly-mode-toggle');

// Load initial state from storage
chrome.storage.local.get(['blockedCount', 'isEnabled', 'friendlyMode'], async (result) => {
    if (result.blockedCount !== undefined) {
        blockedCountEl.textContent = result.blockedCount;
    }
    
    // Default global to true, friendly to true
    statusToggle.checked = result.isEnabled !== false;
    inPageToggle.checked = result.friendlyMode !== false;

    // Reflex Core: Check for recent zaps to show Undo
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url.startsWith('http')) {
        const hostname = new URL(tab.url).hostname;
        const { userCustomRules = {} } = await chrome.storage.local.get('userCustomRules');
        if (userCustomRules[hostname] && userCustomRules[hostname].length > 0) {
            document.getElementById('undo-section').style.display = 'block';
        }
    }
});

// Handle global toggle changes
statusToggle.addEventListener('change', async () => {
    const isEnabled = statusToggle.checked;
    await chrome.storage.local.set({ isEnabled });
    chrome.runtime.sendMessage({ type: 'TOGGLE_STATUS', isEnabled });
    
    // Auto-reload to apply new state
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url.startsWith('http')) chrome.tabs.reload(tab.id);
});

// Handle friendly mode toggle changes
inPageToggle.addEventListener('change', async () => {
    const friendlyMode = inPageToggle.checked;
    await chrome.storage.local.set({ friendlyMode });
    
    // Auto-reload to apply new state
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url.startsWith('http')) chrome.tabs.reload(tab.id);
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

// Handle Reset Site Rules
document.getElementById('reset-rules-btn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
        const hostname = new URL(tab.url).hostname;
        const { userCustomRules = {} } = await chrome.storage.local.get('userCustomRules');
        
        if (userCustomRules[hostname]) {
            delete userCustomRules[hostname];
            await chrome.storage.local.set({ userCustomRules });
            chrome.tabs.reload(tab.id);
            window.close();
        }
    }
});

// Reflex Core: Handle Undo (Negative Learning)
document.getElementById('undo-btn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const hostname = new URL(tab.url).hostname;
    const { userCustomRules = {} } = await chrome.storage.local.get('userCustomRules');
    
    if (userCustomRules[hostname] && userCustomRules[hostname].length > 0) {
        // Get the last rule (the one to undo)
        const undoneRule = userCustomRules[hostname].pop();
        await chrome.storage.local.set({ userCustomRules });

        // Send 'NEGATIVE_LEARNING' signal to the brain
        if (undoneRule && undoneRule.fingerprint) {
            chrome.runtime.sendMessage({ 
                type: 'NEGATIVE_LEARNING', 
                fingerprint: undoneRule.fingerprint 
            });
        }

        chrome.tabs.reload(tab.id);
        window.close();
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
