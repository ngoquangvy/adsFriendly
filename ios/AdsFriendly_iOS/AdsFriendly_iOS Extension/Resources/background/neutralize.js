(function() {
  var bgApi = (typeof browser !== 'undefined') ? browser : chrome;

  window.neutralizeTab = function(tabId, openerTabId, url) {
    console.log("[AdsFriendly BG] neutralizeTab:", tabId, "url:", url);
    if (typeof bgRecordAdEvent === "function") {
      bgRecordAdEvent({
        unit: "navigation",
        label: "ad",
        label_source: "heuristic_blocked",
        ad_type: "popup",
        targetUrl: url,
        action: "block",
        outcome: "neutralized_tab",
        surface: "background_tab_guard",
        evidence: {
          tab_id_present: !!tabId,
          opener_tab_id_present: !!openerTabId
        }
      });
    }
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
