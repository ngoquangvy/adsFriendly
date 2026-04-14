(function() {
    let isActive = false;
    let hoveredElement = null;
    let overlay = null;
    let controlPanel = null;

    // Initialize UI elements
    const createUI = () => {
        if (overlay) return;
        
        overlay = document.createElement('div');
        overlay.id = 'adsfriendly-picker-overlay';
        overlay.style.cssText = `
            position: fixed;
            pointer-events: none;
            z-index: 2147483647;
            background: rgba(16, 185, 129, 0.2);
            border: 2px solid #10b981;
            transition: all 0.1s ease;
            display: none;
        `;
        document.body.appendChild(overlay);

        controlPanel = document.createElement('div');
        controlPanel.id = 'adsfriendly-picker-panel';
        controlPanel.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 2147483647;
            background: #1e293b;
            color: white;
            padding: 12px 20px;
            border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
            display: none;
            flex-direction: column;
            gap: 10px;
            font-family: system-ui, -apple-system, sans-serif;
            border: 1px solid rgba(255,255,255,0.1);
        `;
        controlPanel.innerHTML = `
            <div style="font-weight: bold; font-size: 0.9rem; color: #10b981;">🎯 Magic Wand Active</div>
            <div style="font-size: 0.75rem; color: #94a3b8;">Click an ad to zap it. Use Scroll to expand area.</div>
            <div id="selector-display" style="font-family: monospace; font-size: 0.7rem; background: #0f172a; padding: 5px; border-radius: 4px; max-width: 300px; overflow: hidden; text-overflow: ellipsis;">...</div>
            <div style="display: flex; gap: 8px;">
                <button id="zap-confirm" style="flex: 1; background: #10b981; color: white; border: none; padding: 6px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: bold;">Zap It!</button>
                <button id="zap-cancel" style="background: #ef4444; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.8rem;">Cancel</button>
            </div>
        `;
        document.body.appendChild(controlPanel);

        document.getElementById('zap-cancel').onclick = stopPicker;
        document.getElementById('zap-confirm').onclick = confirmZap;
    };

    const startPicker = () => {
        if (isActive) return;
        isActive = true;
        createUI();
        overlay.style.display = 'block';
        controlPanel.style.display = 'flex';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('click', handleClick, true);
        document.addEventListener('scroll', handleScroll, true);
        document.addEventListener('keydown', handleKeyDown);
    };

    const stopPicker = () => {
        isActive = false;
        if (overlay) overlay.style.display = 'none';
        if (controlPanel) controlPanel.style.display = 'none';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('click', handleClick, true);
        document.removeEventListener('scroll', handleScroll, true);
        document.removeEventListener('keydown', handleKeyDown);
    };

    const handleMouseMove = (e) => {
        if (!isActive) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && el !== overlay && !controlPanel.contains(el)) {
            updateSelection(el);
        }
    };

    const updateSelection = (el) => {
        hoveredElement = el;
        const rect = el.getBoundingClientRect();
        overlay.style.top = rect.top + 'px';
        overlay.style.left = rect.left + 'px';
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';
        
        const selector = generateSelector(el);
        document.getElementById('selector-display').textContent = selector;
    };

    const handleScroll = (e) => {
        if (!isActive || !hoveredElement) return;
        
        // Prevent default scroll when picking
        e.preventDefault();

        // Up/Down wheel to expand/shrink selection hierarchy
        if (e.deltaY < 0 && hoveredElement.parentElement && hoveredElement.parentElement !== document.body) {
            // Expand
            updateSelection(hoveredElement.parentElement);
        } else if (e.deltaY > 0) {
            // Shrink (Requires storing history, let's keep it simple for now and just allow re-hovering)
        }
    };

    const handleClick = (e) => {
        if (!isActive) return;
        e.preventDefault();
        e.stopPropagation();
        confirmZap();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') stopPicker();
    };

    const generateSelector = (el) => {
        if (el.id) return `#${el.id}`;
        
        // Try to find a meaningful class container if it looks like an ad
        let current = el;
        while (current && current !== document.body) {
            if (current.id && (current.id.includes('ad') || current.id.includes('banner'))) {
                return `#${current.id}`;
            }
            if (current.className && typeof current.className === 'string') {
                const parts = current.className.split(' ').filter(c => c.includes('ad') || c.includes('banner') || c.includes('container'));
                if (parts.length > 0) return `.${parts[0]}`;
            }
            current = current.parentElement;
        }

        // Fallback to a simple hierarchical path if no "ad" marks found
        return el.tagName.toLowerCase() + (el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    };

    const confirmZap = async () => {
        const selector = document.getElementById('selector-display').textContent;
        const hostname = window.location.hostname;

        // Save rule
        const { userCustomRules = {} } = await chrome.storage.local.get('userCustomRules');
        if (!userCustomRules[hostname]) userCustomRules[hostname] = [];
        
        if (!userCustomRules[hostname].includes(selector)) {
            userCustomRules[hostname].push(selector);
            await chrome.storage.local.set({ userCustomRules });
        }

        // Apply immediately
        if (hoveredElement) {
            hoveredElement.style.opacity = '0';
            hoveredElement.style.pointerEvents = 'none';
        }

        stopPicker();
        // Optional: Notify background to update counts or rules
    };

    // Listen for activation from background/popup
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'START_PICKER') {
            startPicker();
        }
    });

})();
