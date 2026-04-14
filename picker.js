(function() {
    let isActive = false;
    let hoveredElement = null;
    let selectedItems = []; // Array of { element, selector, fingerprint }
    let overlays = []; // Array of overlay DOM elements
    
    let activeOverlay = null; // The one following the cursor
    let controlPanel = null;

    const GENERIC_CLASSES = ['lazyloaded', 'ls-is-cached', 'active', 'show', 'showing', 'visible', 'container', 'inner', 'wrapper', 'img-responsive'];
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
        
        controlPanel.innerHTML = `
            <div style="font-weight: bold; font-size: 1rem; color: ${color};">${errorMsg ? '⚠️' : '🎯'}</div>
            <div style="display: flex; flex-direction: column;">
                <div style="font-weight: bold; font-size: 0.85rem; color: ${errorMsg ? '#f87171' : 'white'};">${errorMsg || (count > 0 ? `${count} Ads Marked` : 'Select Ads to Zap')}</div>
                <div style="font-size: 0.7rem; color: #94a3b8;">${errorMsg ? 'Please select a smaller area' : (count > 0 ? 'Press <b>Enter</b> to Zap all, <b>Esc</b> to Cancel' : 'Click to mark, Scroll to expand')}</div>
            </div>
            ${(count > 0 && !errorMsg) ? `<button id="zap-confirm-btn" style="background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: bold;">Zap All</button>` : ''}
        `;
        const btn = document.getElementById('zap-confirm-btn');
        if (btn) btn.onclick = confirmAllZaps;
    };

    const startPicker = () => {
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
        
        // Safety: Prevent selecting structural tags
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
        const rect = el.getBoundingClientRect();
        
        // AREA CHECK: If area is > 75% of viewport, it's a "Nuke" risk
        const area = rect.width * rect.height;
        const viewportArea = window.innerWidth * window.innerHeight;
        const isDangerous = area > viewportArea * 0.75;

        activeOverlay.style.top = rect.top + 'px';
        activeOverlay.style.left = rect.left + 'px';
        activeOverlay.style.width = rect.width + 'px';
        activeOverlay.style.height = rect.height + 'px';
        
        if (isDangerous) {
            activeOverlay.style.background = 'rgba(239, 68, 68, 0.3)';
            activeOverlay.style.outlineColor = '#ef4444';
            updatePanelUI("Vùng chọn quá lớn (Rủi ro xóa toàn trang)");
        } else {
            activeOverlay.style.background = 'rgba(16, 185, 129, 0.2)';
            activeOverlay.style.outlineColor = '#10b981';
            updatePanelUI();
        }

        // Update Floating Panel Position
        const panelHeight = controlPanel.offsetHeight || 50;
        let panelTop = rect.top - panelHeight - 12;
        if (panelTop < 12) panelTop = rect.bottom + 12;
        
        controlPanel.style.top = panelTop + 'px';
        controlPanel.style.left = Math.max(12, Math.min(window.innerWidth - controlPanel.offsetWidth - 12, rect.left)) + 'px';
    };

    const handleClick = (e) => {
        if (!isActive) return;
        
        // Prevent click if area is dangerous
        const rect = hoveredElement.getBoundingClientRect();
        if (rect.width * rect.height > window.innerWidth * window.innerHeight * 0.75) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && !selectedItems.some(item => item.element === el)) {
            markElement(el);
        }
    };

    const markElement = (el) => {
        const selector = generateSelector(el);
        if (!selector) return; // Silent reject dangerous selectors

        const fingerprint = generateFingerprint(el);
        selectedItems.push({ element: el, selector, fingerprint });
        
        // Add permanent highlight
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

    const generateSelector = (el) => {
        const tag = el.tagName.toLowerCase();
        
        // High Priority: ID
        if (el.id && !GENERIC_CLASSES.some(gc => el.id.includes(gc))) return `#${el.id}`;
        
        // Specialized Priority: Ad Attributes (href domain)
        const parentLink = el.closest('a');
        if (parentLink && parentLink.href) {
            try {
                const url = new URL(parentLink.href);
                const domain = url.hostname.split('.').slice(-2).join('.');
                if (domain && domain.length > 4) {
                    return `${tag}[href*="${domain}"], a[href*="${domain}"] ${tag}`;
                }
            } catch (e) {}
        }

        // Parent Anchoring (MUST NOT be tag-only for structural tags)
        let current = el.parentElement;
        let depth = 0;
        while (current && current !== document.body && depth < 3) {
            if (current.id && !GENERIC_CLASSES.some(gc => current.id.includes(gc))) {
                return `#${current.id} ${tag}`;
            }
            if (current.className && typeof current.className === 'string') {
                const pClasses = current.className.split(/\s+/).filter(c => c && !GENERIC_CLASSES.includes(c));
                if (pClasses.length > 0) {
                    return `.${pClasses[0]} ${tag}`;
                }
            }
            current = current.parentElement;
            depth++;
        }

        // REJECT single common tags (Anti-Nuke Guardrail)
        const dangerousTags = ['div', 'span', 'p', 'a', 'li', 'ul', 'img', 'section'];
        if (dangerousTags.includes(tag)) {
            return null; // Too broad to be safe
        }

        return tag;
    };

    const generateFingerprint = (el) => ({
        tag: el.tagName.toLowerCase(),
        className: el.className,
        parentId: el.parentElement ? el.parentElement.id : null,
        parentClass: el.parentElement ? el.parentElement.className : null,
        alt: el.alt || null,
        title: el.title || null
    });

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
        
        // Notify the 'Brain' (background script) to synthesize new patterns
        chrome.runtime.sendMessage({ type: 'SYNC_LEARNING' });

        stopPicker();
    };

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'START_PICKER') startPicker();
    });

})();
