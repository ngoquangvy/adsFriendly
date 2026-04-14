(function() {
    let isActive = false;
    let hoveredElement = null;
    let selectedItems = []; // Array of { element, selector, fingerprint }
    let overlays = []; // Array of overlay DOM elements
    
    let activeOverlay = null; // The one following the cursor
    let controlPanel = null;

    const GENERIC_CLASSES = [
        'lazyloaded', 'ls-is-cached', 'active', 'show', 'showing', 'visible', 'container', 'inner', 'wrapper', 'img-responsive',
        'swiper-wrapper', 'swiper-slide', 'swiper-container', 'owl-stage', 'owl-item', 'slick-track', 'slick-slide', 'carousel-inner'
    ];
    const STRUCTURAL_TAGS = ['html', 'body', 'header', 'footer', 'nav', 'main', 'section', 'article', 'aside'];

    // Initialize UI elements
    const createUI = () => {
        if (activeOverlay) return;
        
        activeOverlay = document.createElement('div');
        activeOverlay.id = 'adsfriendly-picker-active-overlay';
        activeOverlay.style.cssText = `
            position: fixed;
            pointer-events: none;
            z-index: 2147483647;
            background: rgba(16, 185, 129, 0.2);
            outline: 2px solid #10b981;
            box-shadow: 0 0 15px rgba(16, 185, 129, 0.4);
            transition: all 0.1s ease;
            display: none;
            border-radius: 4px;
        `;
        document.body.appendChild(activeOverlay);

        controlPanel = document.createElement('div');
        controlPanel.id = 'adsfriendly-picker-panel';
        controlPanel.style.cssText = `
            position: fixed;
            z-index: 2147483647;
            background: #1e293b;
            color: white;
            padding: 10px 16px;
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.4);
            display: none;
            flex-direction: row;
            align-items: center;
            gap: 15px;
            font-family: system-ui, -apple-system, sans-serif;
            border: 1px solid rgba(255,255,255,0.1);
            pointer-events: auto;
        `;
        document.body.appendChild(controlPanel);

        updatePanelUI();
    };

    const updatePanelUI = (errorMsg = null) => {
        if (!controlPanel) return;
        const count = selectedItems.length;
        const color = errorMsg ? '#ef4444' : '#10b981';
        
        let videoContext = false;
        if (hoveredElement) {
            videoContext = hoveredElement.tagName === 'VIDEO' || hoveredElement.querySelector('video') || hoveredElement.closest('.jw-video, .video-js, .fluid_player_instance');
        }

        controlPanel.innerHTML = `
            <div style="font-weight: bold; font-size: 1rem; color: ${color};">${errorMsg ? '⚠️' : (videoContext ? '🎥' : '🎯')}</div>
            <div style="display: flex; flex-direction: column;">
                <div style="font-weight: bold; font-size: 0.85rem; color: ${errorMsg ? '#f87171' : 'white'};">${errorMsg || (videoContext ? 'Video Player Detected' : (count > 0 ? `${count} Ads Marked` : 'Select Ads to Zap'))}</div>
                <div style="font-size: 0.7rem; color: #94a3b8;">${errorMsg ? 'Please select a smaller area' : (videoContext ? 'Is this a Video Ad? Mark it to Neutralize.' : (count > 0 ? 'Press <b>Enter</b> to Zap all, <b>Esc</b> to Cancel' : 'Click to mark, Scroll to expand'))}</div>
            </div>
            <div style="display: flex; gap: 8px;">
                ${videoContext ? `<button id="neutralize-video-btn" style="background: #a855f7; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: bold;">Neutralize</button>` : ''}
                ${(count > 0 && !errorMsg) ? `<button id="zap-confirm-btn" style="background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: bold;">Zap All</button>` : ''}
            </div>
        `;

        const zapBtn = document.getElementById('zap-confirm-btn');
        if (zapBtn) zapBtn.onclick = confirmAllZaps;

        const neuBtn = document.getElementById('neutralize-video-btn');
        if (neuBtn) neuBtn.onclick = handleNeutralizeVideo;
    };

    const handleNeutralizeVideo = async () => {
        if (!hoveredElement) return;
        const video = hoveredElement.tagName === 'VIDEO' ? hoveredElement : hoveredElement.querySelector('video') || hoveredElement.closest('div').querySelector('video');
        
        if (video) {
            console.log('[AdsFriendly Picker] Neutralizing Video Ad manually:', video.currentSrc);
            
            // 1. Immediate Action (Locally speed up)
            if (typeof VideoSurgeon !== 'undefined') {
                VideoSurgeon.accelerate(video);
            }

            // 2. Training (Notify Brain)
            chrome.runtime.sendMessage({
                type: 'LEARN_VIDEO_AD',
                hostname: window.location.hostname,
                src: video.currentSrc || video.src,
                classes: video.className + ' ' + (video.parentElement ? video.parentElement.className : '')
            });

            // 3. UI Feedback
            updatePanelUI("Video Neutralized! (Learning pattern...)");
            setTimeout(() => stopPicker(), 1500);
        }
    };

    const startPicker = async () => {
        if (isActive) return;
        isActive = true;
        createUI();
        activeOverlay.style.display = 'block';
        controlPanel.style.display = 'flex';
        selectedItems = [];
        clearOverlays();
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('click', handleClick, true);
        document.addEventListener('scroll', handleScroll, true);
        document.addEventListener('keydown', handleKeyDown);

        // Shadow Brain: Auto-Prediction Phase
        console.log("%c[AdsFriendly AI] Starting Picker - Predictive Scan initiated...", "color: #10b981; font-weight: bold;");
        const { globalAdPatterns = [] } = await chrome.storage.local.get('globalAdPatterns');
        if (globalAdPatterns.length > 0) {
            const elements = document.querySelectorAll('img, a, div[style*="background-image"], [href*="http"]');
            let autoMarkedCount = 0;
            elements.forEach(el => {
                if (STRUCTURAL_TAGS.includes(el.tagName.toLowerCase())) return;
                
                let score = 0;
                let reasons = [];
                globalAdPatterns.forEach(p => {
                    if (p.type === 'alt' && el.alt === p.value) { score += p.confidence; reasons.push(`alt='${p.value}'`); }
                    if (p.type === 'title' && el.title === p.value) { score += p.confidence; reasons.push(`title='${p.value}'`); }
                    if (p.type === 'domain') {
                        const link = el.closest('a');
                        if (link && link.href && link.href.includes(p.value)) { score += p.confidence; reasons.push(`domain='${p.value}'`); }
                    }
                });

                if (score >= 0.9) {
                    markElement(el);
                    autoMarkedCount++;
                    console.log(`[AdsFriendly AI] Auto-marked element: %o\nConfidence: ${(score*100).toFixed(1)}%\nReason: ${reasons.join(', ')}`, el);
                }
            });
            if (autoMarkedCount > 0) {
                console.log(`[AdsFriendly AI] Auto-marked ${autoMarkedCount} high-confidence ads.`);
                updatePanelUI();
            }
        }
    };

    const stopPicker = () => {
        isActive = false;
        if (activeOverlay) activeOverlay.style.display = 'none';
        if (controlPanel) controlPanel.style.display = 'none';
        clearOverlays();
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('click', handleClick, true);
        document.removeEventListener('scroll', handleScroll, true);
        document.removeEventListener('keydown', handleKeyDown);
    };

    const clearOverlays = () => {
        overlays.forEach(o => o.remove());
        overlays = [];
    };

    const handleMouseMove = (e) => {
        if (!isActive) return;
        let el = document.elementFromPoint(e.clientX, e.clientY);
        
        if (el && STRUCTURAL_TAGS.includes(el.tagName.toLowerCase())) {
            return;
        }

        if (el && el !== activeOverlay && !controlPanel.contains(el) && !isOverlay(el)) {
            updateSelection(el);
        }
    };

    const isOverlay = (el) => el.id && (el.id.includes('overlay') || el.id.includes('panel'));

    const updateSelection = (el) => {
        hoveredElement = el;
        const selector = generateSelector(el);
        const validation = validateSelector(selector);
        
        const rect = el.getBoundingClientRect();
        activeOverlay.style.top = rect.top + 'px';
        activeOverlay.style.left = rect.left + 'px';
        activeOverlay.style.width = rect.width + 'px';
        activeOverlay.style.height = rect.height + 'px';
        
        if (!validation.valid) {
            activeOverlay.style.background = 'rgba(239, 68, 68, 0.3)';
            activeOverlay.style.outlineColor = '#ef4444';
            activeOverlay.style.boxShadow = '0 0 20px rgba(239, 68, 68, 0.5)';
            updatePanelUI(`⚠️ DANGEROUS: ${validation.reason}`);
        } else {
            activeOverlay.style.background = 'rgba(16, 185, 129, 0.2)';
            activeOverlay.style.outlineColor = '#10b981';
            activeOverlay.style.boxShadow = '0 0 15px rgba(16, 185, 129, 0.4)';
            updatePanelUI();
        }

        const panelHeight = controlPanel.offsetHeight || 50;
        let panelTop = rect.top - panelHeight - 12;
        if (panelTop < 12) panelTop = rect.bottom + 12;
        
        controlPanel.style.top = panelTop + 'px';
        controlPanel.style.left = Math.max(12, Math.min(window.innerWidth - controlPanel.offsetWidth - 12, rect.left)) + 'px';
    };

    const handleClick = (e) => {
        if (!isActive || !hoveredElement) return;
        
        const selector = generateSelector(hoveredElement);
        const validation = validateSelector(selector);
        
        if (!validation.valid) {
            console.warn('[AdsFriendly Picker] Blocked dangerous selection:', validation.reason);
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && !selectedItems.some(item => item.element === el)) {
            markElement(el, selector);
        }
    };

    const markElement = (el, selector) => {
        if (!selector) return; 

        const fingerprint = generateFingerprint(el);
        selectedItems.push({ element: el, selector, fingerprint });
        
        const rect = el.getBoundingClientRect();
        const pOverlay = document.createElement('div');
        pOverlay.style.cssText = `
            position: fixed;
            top: ${rect.top}px;
            left: ${rect.left}px;
            width: ${rect.width}px;
            height: ${rect.height}px;
            background: rgba(16, 185, 129, 0.3);
            border: 2px solid #10b981;
            pointer-events: none;
            z-index: 2147483646;
            border-radius: 4px;
        `;
        document.body.appendChild(pOverlay);
        overlays.push(pOverlay);
        
        updatePanelUI();
    };

    const handleScroll = (e) => {
        if (!isActive || !hoveredElement) return;
        e.preventDefault();
        if (e.deltaY < 0 && hoveredElement.parentElement && hoveredElement.parentElement !== document.body) {
            updateSelection(hoveredElement.parentElement);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') stopPicker();
        if (e.key === 'Enter' && selectedItems.length > 0) confirmAllZaps();
    };

    const confirmAllZaps = async () => {
        const hostname = window.location.hostname;
        const { userCustomRules = {} } = await chrome.storage.local.get('userCustomRules');
        if (!userCustomRules[hostname]) userCustomRules[hostname] = [];

        let addedCount = 0;

        selectedItems.forEach(item => {
            // Final Safety check
            const validation = validateSelector(item.selector);
            if (!validation.valid) {
                console.error('[AdsFriendly Picker] Skipping dangerous rule in Zap All:', item.selector, validation.reason);
                return;
            }

            const ruleObject = {
                selector: item.selector,
                fingerprint: item.fingerprint,
                timestamp: Date.now(),
                timesZapped: 1
            };
            
            const existingIndex = userCustomRules[hostname].findIndex(r => 
                (typeof r === 'string' ? r === item.selector : r.selector === item.selector)
            );

            if (existingIndex > -1) userCustomRules[hostname][existingIndex] = ruleObject;
            else userCustomRules[hostname].push(ruleObject);

            item.element.style.opacity = '0';
            item.element.style.pointerEvents = 'none';
            addedCount++;
        });

        if (addedCount > 0) {
            await chrome.storage.local.set({ userCustomRules });
            chrome.runtime.sendMessage({ type: 'SYNC_LEARNING' });
        }
        
        stopPicker();
    };

    const generateSelector = (el) => {
        const tag = el.tagName.toLowerCase();
        const structuralTags = ['div', 'span', 'p', 'a', 'li', 'ul', 'img', 'section', 'article', 'main', 'aside'];
        
        const isSafeId = (id) => id && !GENERIC_CLASSES.some(gc => id.includes(gc)) && !/[0-9]{5,}/.test(id);
        const isSafeClass = (cls) => cls && typeof cls === 'string' && cls.split(/\s+/).some(c => c && !GENERIC_CLASSES.includes(c) && !/[0-9]{5,}/.test(c));

        // 1. Specific ID is best
        if (isSafeId(el.id)) return `#${el.id}`;
        
        // 2. Try to build a parent-child relationship for better specificity
        const buildPath = (curr, depth = 0) => {
            if (!curr || curr === document.body || depth > 2) return '';
            
            let part = curr.tagName.toLowerCase();
            if (isSafeId(curr.id)) return `#${curr.id} ${part}`.trim();
            
            if (curr.className && typeof curr.className === 'string') {
                const validClass = curr.className.split(/\s+/).find(c => c && !GENERIC_CLASSES.includes(c) && !/[0-9]{5,}/.test(c));
                if (validClass) part = `.${validClass}`;
            }

            const parentPart = buildPath(curr.parentElement, depth + 1);
            return (parentPart ? parentPart + ' > ' : '') + part;
        };

        const path = buildPath(el);
        
        // 3. Last resort fallback (only for non-structural tags or very small elements)
        if (!path || structuralTags.includes(path.split(' > ').pop())) {
            const rect = el.getBoundingClientRect();
            if (rect.width * rect.height > 10000 || structuralTags.includes(tag)) {
                return null; // Too dangerous to use bare tag
            }
            return tag;
        }

        return path;
    };

    const validateSelector = (selector) => {
        if (!selector) return { valid: false, reason: "No selector generated" };
        
        try {
            const matches = document.querySelectorAll(selector);
            if (matches.length > 5) return { valid: false, reason: `Matches too many elements (${matches.length})` };
            
            let totalArea = 0;
            const viewportArea = window.innerWidth * window.innerHeight;
            
            matches.forEach(m => {
                const r = m.getBoundingClientRect();
                totalArea += r.width * r.height;
            });

            if (totalArea > viewportArea * 0.35) return { valid: false, reason: "Selector area is too large (>35%)" };
            
            return { valid: true };
        } catch (e) {
            return { valid: false, reason: "Invalid selector logic" };
        }
    };

    const generateFingerprint = (el) => {
        const cleanId = (id) => (id && !/(_[a-z0-9]{1,3}_|[0-9]{5,})/.test(id)) ? id : null;
        const cleanClass = (cls) => {
            if (!cls || typeof cls !== 'string') return null;
            return cls.split(/\s+/).filter(c => !/(active|hover|focus|selected|clicked)/.test(c)).join(' ');
        };

        let linkDomain = null;
        const link = el.closest('a');
        if (link && link.href) {
            try {
                const url = new URL(link.href);
                if (url.hostname !== window.location.hostname) {
                    linkDomain = url.hostname.split('.').slice(-2).join('.');
                }
            } catch (e) {}
        }

        return {
            tag: el.tagName.toLowerCase(),
            className: cleanClass(el.className),
            parentId: el.parentElement ? cleanId(el.parentElement.id) : null,
            parentClass: el.parentElement ? cleanClass(el.parentElement.className) : null,
            alt: el.alt || null,
            title: el.title || null,
            linkDomain: linkDomain
        };
    };

    const confirmAllZaps = async () => {
        const hostname = window.location.hostname;
        const { userCustomRules = {} } = await chrome.storage.local.get('userCustomRules');
        if (!userCustomRules[hostname]) userCustomRules[hostname] = [];

        selectedItems.forEach(item => {
            const ruleObject = {
                selector: item.selector,
                fingerprint: item.fingerprint,
                timestamp: Date.now(),
                timesZapped: 1
            };
            
            const existingIndex = userCustomRules[hostname].findIndex(r => 
                (typeof r === 'string' ? r === item.selector : r.selector === item.selector)
            );

            if (existingIndex > -1) userCustomRules[hostname][existingIndex] = ruleObject;
            else userCustomRules[hostname].push(ruleObject);

            item.element.style.opacity = '0';
            item.element.style.pointerEvents = 'none';
        });

        await chrome.storage.local.set({ userCustomRules });
        chrome.runtime.sendMessage({ type: 'SYNC_LEARNING' });
        stopPicker();
    };

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'START_PICKER') startPicker();
    });

})();
