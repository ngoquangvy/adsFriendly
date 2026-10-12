(function () {
  var api = typeof browser !== "undefined" ? browser : chrome;
  window.neutralizeTab = function (tabId, openerTabId, url, remembered) {
    (async function () {
      try {
        await AFShared.callApi(api.tabs, "update", tabId, { url: "about:blank" });
      } catch (error) {
        bgRecordDiagnostic({ reason: "neutralize_failed", host: AFShared.httpUrl(url)?.hostname || "",
          error: String(error.message).slice(0, 120) });
        return;
      }
      if (typeof bgRecordAdEvent === "function") bgRecordAdEvent({
        unit: "navigation", label: "ad", label_source: remembered ? "user_block" : "heuristic_blocked",
        ad_type: "popup", targetUrl: url, action: "block", outcome: "neutralized_tab", surface: "background_tab_guard"
      });
      var source;
      try { source = await AFShared.callApi(api.tabs, "get", openerTabId); } catch (_) {}
      bgRecordBlock(source?.url || url, "popup", 1);
      if (typeof openerTabId === "number") {
        try {
          await AFShared.callApi(api.tabs, "sendMessage", openerTabId,
            { action: "popup_blocked", url, remembered: remembered === true }, { frameId: 0 });
        } catch (_) { bgRecordDiagnostic({ reason: "toast_delivery_failed", host: AFShared.httpUrl(source?.url)?.hostname || "" }); }
      }
      // Do not close a tab that the user has already navigated away from blank.
      try {
        var current = await AFShared.callApi(api.tabs, "get", tabId);
        if (current?.url === "about:blank") await AFShared.callApi(api.tabs, "remove", tabId);
      } catch (_) { bgRecordDiagnostic({ reason: "tab_close_failed", host: AFShared.httpUrl(url)?.hostname || "" }); }
    })().catch(console.error);
  };
})();
