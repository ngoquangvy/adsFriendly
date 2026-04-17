// core/modules/dom_vision.js
window.AdsFriendlyDomVision = {
    findSkipButton(root) {
        const selectors = [
            '#preroll-player-skip',
            '.jw-skip',
            '.jw-skip-button',
            '.ytp-skip-ad-button',
            '.ytp-ad-skip-button',
            '.ytp-ad-skip-button-modern',
            '.videoAdUiSkipButton'
        ];

        for (const sel of selectors) {
            const btn = this.pierceShadow(root || document, sel) || (root !== document ? this.pierceShadow(document, sel) : null);
            if (!btn) continue;
            const style = getComputedStyle(btn);
            if (style.display === 'none' || style.visibility === 'hidden' || btn.getClientRects().length === 0) continue;
            return btn;
        }

        return null;
    },

    pierceShadow(root, selector) {
        const element = root.querySelector(selector);
        if (element) return element;

        const shadows = root.querySelectorAll('*');
        for (const el of shadows) {
            if (el.shadowRoot) {
                const found = this.pierceShadow(el.shadowRoot, selector);
                if (found) return found;
            }
        }
        return null;
    },

    generateSelector(el) {
        if (el.id && !/\d{4,}/.test(el.id)) return `#${el.id}`;

        const classes = Array.from(el.classList)
            .filter(c => !/\d{4,}/.test(c)) // Filter out dynamic hashes
            .filter(c => !c.includes('hover') && !c.includes('focus'))
            .join('.');

        return classes ? `.${classes}` : null;
    },

    createNeutralizeOverlay() {
        if (document.getElementById('adsfriendly-neutralize-overlay')) return;
        if (!document.body) {
            setTimeout(() => this.createNeutralizeOverlay(), 50);
            return;
        }

        this.overlay = document.createElement('div');
        this.overlay.id = 'adsfriendly-neutralize-overlay';
        this.overlay.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 24px; font-weight: bold; margin-bottom: 8px;">AdsFriendly AI</div>
                <div style="font-size: 14px; opacity: 0.8;">Neutralizing Ad...</div>
                <div style="margin-top: 15px; width: 40px; height: 40px; border: 3px solid #22c55e; border-top-color: transparent; border-radius: 50%; animation: adsfriendly-spin 1s linear infinite; margin-left: auto; margin-right: auto;"></div>
            </div>
            <style>
                #adsfriendly-neutralize-overlay {
                    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0,0,0,0.9); backdrop-filter: blur(15px);
                    z-index: 1000; display: none; align-items: center; justify-content: center;
                    color: #22c55e; font-family: sans-serif; pointer-events: none;
                }
                @keyframes adsfriendly-spin { to { transform: rotate(360deg); } }
            </style>
        `;
        document.body.appendChild(this.overlay);
    }
};
