var popupApi = (typeof browser !== 'undefined') ? browser : chrome;
var toggle = document.getElementById("telemetry-toggle");

if (toggle && popupApi.storage && popupApi.storage.local) {
  popupApi.storage.local.get(["afsTelemetryEnabled"], function(result) {
    toggle.checked = result.afsTelemetryEnabled === true;
  });

  toggle.addEventListener("change", function() {
    popupApi.storage.local.set({ afsTelemetryEnabled: toggle.checked }, function() {
      if (toggle.checked) {
        popupApi.runtime.sendMessage({ action: "flush_telemetry" });
      }
    });
  });
}
