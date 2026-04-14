// Logic for blocked.html - Smart BlockAd

const params = new URLSearchParams(window.location.search);
const urlToOpen = params.get('url');
const sourceDomain = params.get('source');

// Safe parsing of the target domain
let targetDomain = '';
try {
    targetDomain = new URL(urlToOpen).hostname;
} catch (e) {
    console.error("Invalid URL to open:", urlToOpen);
}

document.getElementById('target-url').textContent = urlToOpen;
document.getElementById('source-domain').textContent = sourceDomain;

const sendMessage = (action) => {
    chrome.runtime.sendMessage({
        type: 'USER_DECISION',
        action: action,
        domain: targetDomain,
        url: urlToOpen
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Message error:", chrome.runtime.lastError);
            // Fallback to preserve user choice even if messaging fails
            if (action === 'ONCE' || action === 'WHITELIST') {
                window.location.href = urlToOpen;
            } else {
                window.close();
            }
            return;
        }

        if (action === 'BLACKLIST' || action === 'CLOSE') {
            window.close();
        } else {
            window.location.href = urlToOpen;
        }
    });
};

document.getElementById('btn-whitelist').onclick = () => sendMessage('WHITELIST');
document.getElementById('btn-blacklist').onclick = () => sendMessage('BLACKLIST');
document.getElementById('btn-once').onclick = () => sendMessage('ONCE');
document.getElementById('btn-close').onclick = () => sendMessage('CLOSE');

let timeLeft = 15;
const timerElement = document.getElementById('seconds');
const countdown = setInterval(() => {
    timeLeft--;
    timerElement.textContent = timeLeft;
    if (timeLeft <= 0) {
        clearInterval(countdown);
        window.close();
    }
}, 1000);
