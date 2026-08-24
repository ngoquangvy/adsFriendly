var popupApi = typeof browser !== "undefined" ? browser : chrome;
var activeHostname = "";
var currentState = null;

function hostFromUrl(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ""; }
}

function showError(message) {
  var element = document.getElementById("error");
  element.textContent = message;
  element.hidden = !message;
}

function send(message, callback) {
  try {
    popupApi.runtime.sendMessage(message, function(response) {
      var error = popupApi.runtime.lastError;
      if (error) { showError(error.message); return; }
      callback(response || {});
    });
  } catch (error) { showError(error.message); }
}

function render(state) {
  currentState = state;
  document.getElementById("site-host").textContent = activeHostname || "Safari page";
  document.getElementById("site-count").textContent = state.siteBlockedCount || 0;
  document.getElementById("total-count").textContent = state.blockedCount || 0;
  document.getElementById("protection-toggle").checked = state.appSettings && state.appSettings.enabled !== false;
  var enabled = !state.appSettings || state.appSettings.enabled !== false;
  var status = document.getElementById("site-status");
  var dot = document.getElementById("status-dot");
  dot.className = "status-dot";
  if (!enabled) { status.textContent = "Protection off"; dot.classList.add("disabled"); }
  else if (state.policy === "allow") { status.textContent = "Allowed"; dot.classList.add("allow"); }
  else if (state.policy === "block") { status.textContent = "Always blocked"; dot.classList.add("block"); }
  else status.textContent = "Protected";
  document.querySelectorAll("[data-policy]").forEach(function(button) {
    button.classList.toggle("active", button.dataset.policy === (state.policy || "default"));
    button.disabled = !activeHostname;
  });
}

function loadState() {
  send({ action: "get_popup_state", hostname: activeHostname }, function(state) {
    if (state.error) { showError(state.error); return; }
    render(state);
  });
}

document.getElementById("protection-toggle").addEventListener("change", function(event) {
  var settings = Object.assign({}, currentState && currentState.appSettings || {}, { enabled: event.target.checked });
  send({ action: "set_app_settings", settings: settings }, loadState);
});

document.querySelectorAll("[data-policy]").forEach(function(button) {
  button.addEventListener("click", function() {
    if (!activeHostname) return;
    send({ action: "set_site_policy", hostname: activeHostname, policy: button.dataset.policy }, loadState);
  });
});

popupApi.tabs.query({ active: true, lastFocusedWindow: true }, function(tabs) {
  var tab = tabs && tabs[0];
  activeHostname = hostFromUrl(tab && tab.url);
  loadState();
});
