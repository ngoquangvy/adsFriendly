(function() {
  var bgApi = (typeof browser !== 'undefined') ? browser : chrome;

  window.neutralizeTab = function(tabId, openerTabId, url) {
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
            console.log("[AdsFriendly BG] remove failed (tab already blank):", bgApi.runtime.lastError.message);
          } else {
            console.log("[AdsFriendly BG] Tab", tabId, "removed OK");
          }
        });
      }, 100);
    });
  };

  console.log("[AdsFriendly BG] neutralize.js loaded.");
})();
