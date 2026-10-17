(function () {
  var api = typeof browser !== "undefined" ? browser : chrome;
  var dnr = api.declarativeNetRequest;
  var state = { state: "starting", count: 0 };
  var tail = Promise.resolve();
  window.bgGetNetworkState = function () {
    return { ...state };
  };
  function refresh() {
    var operation = tail
      .then(async function () {
        if (
          !dnr?.updateEnabledRulesets ||
          !dnr?.getDynamicRules ||
          !dnr?.updateDynamicRules
        ) {
          state = { state: "unavailable", count: 0 };
          return state;
        }
        var data = await AFShared.storageAdapter().get([
          "appSettings",
          "whitelist",
          "blacklist",
        ]);
        var enabled = data.appSettings?.enabled !== false;
        var current = await AFShared.callApi(dnr, "getDynamicRules");
        var rules = enabled
          ? AFShared.iosSiteAllowRules(
              data.whitelist || [],
              data.blacklist || [],
            )
          : [];
        // Disable first when turning protection off; never touch another feature's IDs.
        if (!enabled)
          await AFShared.callApi(dnr, "updateEnabledRulesets", {
            disableRulesetIds: ["advertising"],
          });
        await AFShared.callApi(dnr, "updateDynamicRules", {
          removeRuleIds: (current || [])
            .filter(
              (rule) =>
                (rule.id >= 20000 && rule.id < 20250) ||
                (rule.id >= 21000 && rule.id < 21250),
            )
            .map((rule) => rule.id),
          addRules: rules,
        });
        if (enabled)
          await AFShared.callApi(dnr, "updateEnabledRulesets", {
            enableRulesetIds: ["advertising"],
          });
        var actual = await AFShared.callApi(dnr, "getEnabledRulesets");
        var active = actual.includes("advertising");
        if (active !== enabled)
          throw new Error(
            "URL filter state did not match the requested setting.",
          );
        state = {
          state: enabled ? "active" : "disabled",
          count: enabled ? AFShared.iosNetworkRules().length : 0,
        };
        return state;
      })
      .catch(function (error) {
        state = {
          state: "error",
          count: 0,
          error: String(error.message || error),
        };
        return state;
      });
    tail = operation;
    return operation;
  }
  window.AFNetworkReady = window.AFSettingsReady.then(refresh);
  api.storage.onChanged.addListener(function (changes, area) {
    if (
      area === "local" &&
      ["appSettings", "whitelist", "blacklist"].some((key) => key in changes)
    )
      refresh();
  });
  window.bgRefreshNetworkRules = refresh;
})();
