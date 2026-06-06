(function() {
  var bgApi = (typeof browser !== 'undefined') ? browser : chrome;

  var lastActiveTabId = null;

  bgApi.tabs.query({ active: true, lastFocusedWindow: true }, function(tabs) {
    if (tabs && tabs[0]) {
      lastActiveTabId = tabs[0].id;
      console.log("[AdsFriendly BG] Init active tab:", lastActiveTabId);
    }
  });

  bgApi.tabs.onActivated.addListener(function(activeInfo) {
    lastActiveTabId = activeInfo.tabId;
  });

  var pendingNewTabs = {};

  function cleanupPending(tabId) {
    setTimeout(function() {
      if (pendingNewTabs[tabId]) {
        delete pendingNewTabs[tabId];
      }
    }, 30000);
  }

  if (bgApi.webNavigation && bgApi.webNavigation.onCreatedNavigationTarget) {
    bgApi.webNavigation.onCreatedNavigationTarget.addListener(function(details) {
      var tabId = details.tabId;
      var url = details.url;
      var sourceTabId = details.sourceTabId;
      console.log("[AdsFriendly BG] onCreatedNavigationTarget:", tabId, url, "source:", sourceTabId);

      bgApi.tabs.get(sourceTabId, function(sourceTab) {
        if (bgApi.runtime.lastError || !sourceTab || !sourceTab.url) return;
        if (!bgAreSameSite(sourceTab.url, url) && !bgIsWhitelisted(url)) {
          neutralizeTab(tabId, sourceTabId, url);
        }
      });
    });
  }

  bgApi.tabs.onCreated.addListener(function(tab) {
    var openerId = tab.openerTabId || lastActiveTabId;
    var originalId = openerId;

    if (openerId && pendingNewTabs[openerId]) {
      originalId = pendingNewTabs[openerId].originalSourceTabId || openerId;
      console.log("[AdsFriendly BG] onCreated:", tab.id, "opener is ad tab, resolve original:", originalId);
    }

    if (openerId) {
      pendingNewTabs[tab.id] = {
        openerTabId: openerId,
        originalSourceTabId: originalId,
        time: Date.now()
      };
      cleanupPending(tab.id);
    }
  });

  function checkNewTabNavigation(tabId, url, source) {
    if (!pendingNewTabs[tabId]) return;

    var info = pendingNewTabs[tabId];
    delete pendingNewTabs[tabId];

    if (bgIsWhitelisted(url)) return;

    var checkTabId = info.originalSourceTabId || info.openerTabId;

    bgApi.tabs.get(checkTabId, function(sourceTab) {
      if (bgApi.runtime.lastError || !sourceTab || !sourceTab.url) {
        bgApi.tabs.get(info.openerTabId, function(fallbackTab) {
          if (bgApi.runtime.lastError || !fallbackTab || !fallbackTab.url) return;
          if (!bgAreSameSite(fallbackTab.url, url)) {
            console.log("[AdsFriendly BG] cross-origin -> BLOCK (fallback)");
            neutralizeTab(tabId, info.openerTabId, url);
          }
        });
        return;
      }
      if (!bgAreSameSite(sourceTab.url, url)) {
        console.log("[AdsFriendly BG] cross-origin -> BLOCK");
        neutralizeTab(tabId, info.openerTabId, url);
      } else {
        console.log("[AdsFriendly BG] same site, allow");
      }
    });
  }

  bgApi.tabs.onUpdated.addListener(function(tabId, changeInfo) {
    if (!changeInfo.url) return;
    checkNewTabNavigation(tabId, changeInfo.url, "onUpdated");
  });

  if (bgApi.webNavigation && bgApi.webNavigation.onCommitted) {
    bgApi.webNavigation.onCommitted.addListener(function(details) {
      if (details.frameId !== 0) return;
      checkNewTabNavigation(details.tabId, details.url, "onCommitted");
    });
  }

  bgApi.tabs.onCreated.addListener(function(tab) {
    var newTabId = tab.id;
    var openerId = tab.openerTabId || lastActiveTabId;
    var originalId = (openerId && pendingNewTabs[openerId])
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
            console.log("[AdsFriendly BG] Chan (timeout backup):", newTab.url);
            neutralizeTab(newTabId, openerId, newTab.url);
          }
        });
      });
    }, 1500);
  });

  console.log("[AdsFriendly BG] tab-tracker.js loaded.");
})();
