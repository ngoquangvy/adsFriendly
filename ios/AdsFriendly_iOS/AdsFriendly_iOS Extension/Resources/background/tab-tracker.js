(function() {
  var bgApi = (typeof browser !== 'undefined') ? browser : chrome;

  var lastActiveTabId = null;
  var trustedClicksByTab = {};
  var lastTrustedClickTime = 0;
  var openOnceUntilByHost = {};

  window.bgAllowPopupOnce = function(url) {
    try { openOnceUntilByHost[new URL(url).hostname.toLowerCase()] = Date.now() + 5000; } catch(e) {}
  };

  function isAllowedOnce(url) {
    try { return (openOnceUntilByHost[new URL(url).hostname.toLowerCase()] || 0) > Date.now(); } catch(e) { return false; }
  }

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

  bgApi.runtime.onMessage.addListener(function(request, sender) {
    if (!request || (request.action !== "trusted_click" && request.action !== "trusted_popup")) return;
    var tabId = sender && sender.tab ? sender.tab.id : null;
    if (!tabId) return;
    trustedClicksByTab[tabId] = {
      url: request.url || "",
      allowAnyPopup: request.action === "trusted_popup",
      time: Date.now()
    };
    lastTrustedClickTime = Date.now();
    setTimeout(function() {
      if (trustedClicksByTab[tabId] && Date.now() - trustedClicksByTab[tabId].time > 5000) {
        delete trustedClicksByTab[tabId];
      }
    }, 6000);
  });

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

      setTimeout(function() {
        bgApi.tabs.get(sourceTabId, function(sourceTab) {
          if (bgApi.runtime.lastError || !sourceTab || !sourceTab.url) return;
          if (shouldAllowNavigation(sourceTabId, sourceTab.url, url)) return;
          if (shouldBlockNavigation(sourceTabId, sourceTab.url, url)) {
            neutralizeTab(tabId, sourceTabId, url);
          }
        });
      }, 180);
    });
  }

  bgApi.tabs.onCreated.addListener(function(tab) {
    var openerId = tab.openerTabId || (hasRecentTrustedClick() ? lastActiveTabId : null);
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
          if (shouldAllowNavigation(info.openerTabId, fallbackTab.url, url)) return;
          if (shouldBlockNavigation(info.openerTabId, fallbackTab.url, url)) {
            console.log("[AdsFriendly BG] cross-origin -> BLOCK (fallback)");
            neutralizeTab(tabId, info.openerTabId, url);
          }
        });
        return;
      }
      if (shouldAllowNavigation(checkTabId, sourceTab.url, url)) return;
      if (shouldBlockNavigation(checkTabId, sourceTab.url, url)) {
        console.log("[AdsFriendly BG] cross-origin -> BLOCK");
        neutralizeTab(tabId, info.openerTabId, url);
      } else {
        console.log("[AdsFriendly BG] same site, allow");
      }
    });
  }

  function scheduleNewTabNavigation(tabId, url, source) {
    var info = pendingNewTabs[tabId];
    if (!info) return;
    info.pendingUrl = url;
    if (info.checkTimer) clearTimeout(info.checkTimer);
    info.checkTimer = setTimeout(function() {
      checkNewTabNavigation(tabId, info.pendingUrl, source);
    }, 180);
  }

  bgApi.tabs.onUpdated.addListener(function(tabId, changeInfo) {
    if (!changeInfo.url) return;
    scheduleNewTabNavigation(tabId, changeInfo.url, "onUpdated");
  });

  if (bgApi.webNavigation && bgApi.webNavigation.onCommitted) {
    bgApi.webNavigation.onCommitted.addListener(function(details) {
      if (details.frameId !== 0) return;
      scheduleNewTabNavigation(details.tabId, details.url, "onCommitted");
    });
  }

  bgApi.tabs.onCreated.addListener(function(tab) {
    var newTabId = tab.id;
    var openerId = tab.openerTabId || (hasRecentTrustedClick() ? lastActiveTabId : null);
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
          if (shouldAllowNavigation(originalId, sourceTab.url, newTab.url)) return;
          if (shouldBlockNavigation(originalId, sourceTab.url, newTab.url)) {
            console.log("[AdsFriendly BG] Chan (timeout backup):", newTab.url);
            neutralizeTab(newTabId, openerId, newTab.url);
          }
        });
      });
    }, 1500);
  });

  function hasRecentTrustedClick() {
    return Date.now() - lastTrustedClickTime < 1500;
  }

  function hasIntentFor(tabId, url) {
    var click = trustedClicksByTab[tabId];
    if (!click) return false;
    if (Date.now() - click.time > 2500) return false;
    if (click.allowAnyPopup) return true;
    if (!click.url) return false;
    return bgAreSameSite(click.url, url);
  }

  function shouldAllowNavigation(sourceTabId, sourceUrl, targetUrl) {
    if (typeof bgIsProtectionEnabled === "function" && !bgIsProtectionEnabled()) return true;
    if (!targetUrl || targetUrl === "" || targetUrl.indexOf("about:") === 0) return true;
    if (isAllowedOnce(targetUrl)) return true;
    if (bgIsUserBlockedPopup(targetUrl)) return false;
    if (bgIsUserAllowedPopup(targetUrl)) return true;
    if (bgIsTrustedInitiator(sourceUrl)) return true;
    if (bgIsWhitelisted(targetUrl)) return true;
    if (bgAreSameSite(sourceUrl, targetUrl)) return true;
    if (hasIntentFor(sourceTabId, targetUrl)) return true;
    return false;
  }

  function shouldBlockNavigation(sourceTabId, sourceUrl, targetUrl) {
    if (typeof bgIsProtectionEnabled === "function" && !bgIsProtectionEnabled()) return false;
    if (!targetUrl || targetUrl === "" || targetUrl.indexOf("about:") === 0) return false;
    if (bgIsUserBlockedPopup(targetUrl)) return true;
    if (shouldAllowNavigation(sourceTabId, sourceUrl, targetUrl)) return false;
    return bgIsAdLikeUrl(targetUrl);
  }

  console.log("[AdsFriendly BG] tab-tracker.js loaded.");
})();
