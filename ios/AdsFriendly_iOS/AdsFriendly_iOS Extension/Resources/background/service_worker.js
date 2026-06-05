// ============================================================
// service_worker.js - LỚP 2: Giám sát và chặn tab mới từ Background
// ============================================================

const BG_WHITELIST = [
  "google.com", "accounts.google.com", "github.com",
  "microsoft.com", "login.microsoftonline.com", "live.com",
  "apple.com", "appleid.apple.com", "facebook.com"
];

function bgIsWhitelisted(url) {
  try {
    const hostname = new URL(url).hostname;
    return BG_WHITELIST.some(d => hostname === d || hostname.endsWith("." + d));
  } catch(e) { return false; }
}

function bgGetRootDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.split('.');
    return parts.slice(-2).join('.');
  } catch(e) { return ''; }
}

function bgAreSameSite(url1, url2) {
  const r1 = bgGetRootDomain(url1);
  const r2 = bgGetRootDomain(url2);
  return r1 !== '' && r2 !== '' && r1 === r2;
}

const bgApi = (typeof browser !== 'undefined') ? browser : chrome;

function neutralizeTab(tabId, openerTabId, url) {
  console.log("[AdsFriendly BG] neutralizeTab:", tabId, "url:", url);
  bgApi.tabs.update(tabId, { url: 'about:blank' }, function() {
    if (bgApi.runtime.lastError) {
      console.log("[AdsFriendly BG] update to blank FAILED:", bgApi.runtime.lastError.message);
      return;
    }
    console.log("[AdsFriendly BG] Tab", tabId, "-> about:blank OK");
    if (openerTabId && url) {
      bgApi.tabs.sendMessage(openerTabId, { action: "popup_blocked", url: url });
    }
    setTimeout(function() {
      bgApi.tabs.remove(tabId, function() {
        if (bgApi.runtime.lastError) {
          console.log("[AdsFriendly BG] remove failed (OK - tab already blank):", bgApi.runtime.lastError.message);
        } else {
          console.log("[AdsFriendly BG] Tab", tabId, "removed OK");
        }
      });
    }, 100);
  });
}

var lastActiveTabId = null;

bgApi.tabs.query({ active: true, lastFocusedWindow: true }, function(tabs) {
  if (tabs && tabs[0]) {
    lastActiveTabId = tabs[0].id;
    console.log("[AdsFriendly BG] Init active tab:", lastActiveTabId);
  }
});

bgApi.tabs.onActivated.addListener(function(activeInfo) {
  lastActiveTabId = activeInfo.tabId;
  console.log("[AdsFriendly BG] Active tab:", lastActiveTabId);
});

var pendingNewTabs = {};

function cleanupPending(tabId) {
  setTimeout(function() {
    if (pendingNewTabs[tabId]) {
      console.log("[AdsFriendly BG] Cleanup pending:", tabId);
      delete pendingNewTabs[tabId];
    }
  }, 30000);
}

// === CHIẾN LƯỢC 1: Bắt window.open() ===
if (bgApi.webNavigation && bgApi.webNavigation.onCreatedNavigationTarget) {
  bgApi.webNavigation.onCreatedNavigationTarget.addListener(function(details) {
    const { sourceTabId, tabId, url } = details;
    console.log("[AdsFriendly BG] onCreatedNavigationTarget:", tabId, url, "source:", sourceTabId);

    bgApi.tabs.get(sourceTabId, function(sourceTab) {
      if (bgApi.runtime.lastError || !sourceTab || !sourceTab.url) return;
      if (!bgAreSameSite(sourceTab.url, url) && !bgIsWhitelisted(url)) {
        neutralizeTab(tabId, sourceTabId, url);
      }
    });
  });
}

// === CHIẾN LƯỢC 2: Ghi nhận tab mới với originalSourceTabId ===
bgApi.tabs.onCreated.addListener(function(tab) {
  var openerId = tab.openerTabId || lastActiveTabId;
  var originalId = openerId;

  if (openerId && pendingNewTabs[openerId]) {
    originalId = pendingNewTabs[openerId].originalSourceTabId || openerId;
    console.log("[AdsFriendly BG] onCreated:", tab.id, "opener is ad tab, resolve original:", originalId);
  }

  console.log("[AdsFriendly BG] onCreated:", tab.id, "openerTabId:", tab.openerTabId, "fallback:", lastActiveTabId, "using:", openerId, "original:", originalId);

  if (openerId) {
    pendingNewTabs[tab.id] = { 
      openerTabId: openerId, 
      originalSourceTabId: originalId, 
      time: Date.now()
    };
    cleanupPending(tab.id);
  } else {
    console.log("[AdsFriendly BG] onCreated: NO OPENER, can't track tab", tab.id);
  }
});

// === CHIẾN LƯỢC 3: Bắt URL change đầu tiên của tab mới ===
function checkNewTabNavigation(tabId, url, source) {
  if (!pendingNewTabs[tabId]) {
    console.log("[AdsFriendly BG] " + source + ": tab", tabId, "not in pending, skip");
    return;
  }
  var info = pendingNewTabs[tabId];
  delete pendingNewTabs[tabId];
  console.log("[AdsFriendly BG] " + source + ":", tabId, url, "opener:", info.openerTabId, "original:", info.originalSourceTabId);

  if (bgIsWhitelisted(url)) {
    console.log("[AdsFriendly BG] whitelisted, skip");
    return;
  }

  var checkTabId = info.originalSourceTabId || info.openerTabId;
  console.log("[AdsFriendly BG] -> getting source tab URL from tab", checkTabId);
  bgApi.tabs.get(checkTabId, function(sourceTab) {
    if (bgApi.runtime.lastError || !sourceTab || !sourceTab.url) {
      console.log("[AdsFriendly BG] source unavailable, fallback to opener", info.openerTabId);
      bgApi.tabs.get(info.openerTabId, function(fallbackTab) {
        if (bgApi.runtime.lastError || !fallbackTab || !fallbackTab.url) {
          console.log("[AdsFriendly BG] fallback also unavailable, give up");
          return;
        }
        console.log("[AdsFriendly BG] fallback url:", fallbackTab.url);
        if (!bgAreSameSite(fallbackTab.url, url)) {
          console.log("[AdsFriendly BG] cross-origin -> BLOCK (fallback)");
          neutralizeTab(tabId, info.openerTabId, url);
        } else {
          console.log("[AdsFriendly BG] same site, allow");
        }
      });
      return;
    }
    console.log("[AdsFriendly BG] source url:", sourceTab.url);
    if (!bgAreSameSite(sourceTab.url, url)) {
      console.log("[AdsFriendly BG] cross-origin -> BLOCK");
      neutralizeTab(tabId, info.openerTabId, url);
    } else {
      console.log("[AdsFriendly BG] same site, allow");
    }
  });
}

// 3a: tabs.onUpdated
bgApi.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  if (!changeInfo.url) return;
  checkNewTabNavigation(tabId, changeInfo.url, "onUpdated");
});

// 3b: webNavigation.onCommitted
if (bgApi.webNavigation && bgApi.webNavigation.onCommitted) {
  bgApi.webNavigation.onCommitted.addListener(function(details) {
    if (details.frameId !== 0) return;
    checkNewTabNavigation(details.tabId, details.url, "onCommitted");
  });
  console.log("[AdsFriendly BG] onCommitted ready.");
}

// === CHIẾN LƯỢC 4: Backup timeout 3s ===
bgApi.tabs.onCreated.addListener(function(tab) {
  const newTabId = tab.id;
  const openerId = tab.openerTabId || lastActiveTabId;
  const originalId = (openerId && pendingNewTabs[openerId])
    ? (pendingNewTabs[openerId].originalSourceTabId || openerId)
    : openerId;
  if (!originalId) return;

  setTimeout(function() {
    if (!pendingNewTabs[newTabId]) return;
    delete pendingNewTabs[newTabId];

    bgApi.tabs.get(newTabId, function(newTab) {
      if (bgApi.runtime.lastError || !newTab || !newTab.url) return;
      if (newTab.url === '' || newTab.url === 'about:blank' || newTab.url.startsWith('about:')) return;
      if (bgIsWhitelisted(newTab.url)) return;

      bgApi.tabs.get(originalId, function(sourceTab) {
        if (bgApi.runtime.lastError || !sourceTab || !sourceTab.url) return;
        if (!bgAreSameSite(sourceTab.url, newTab.url)) {
          console.log("[AdsFriendly BG] Chặn (timeout backup):", newTab.url);
          neutralizeTab(newTabId, openerId, newTab.url);
        }
      });
    });
  }, 1500);
});

// === NHẬN TIN NHẮN TỪ CONTENT SCRIPT ===
bgApi.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "open_tabs" && request.urls) {
    request.urls.forEach(function(url) {
      bgApi.tabs.create({ url: url, active: false });
    });
  }
});

console.log("[AdsFriendly BG] Service Worker đã khởi động.");
