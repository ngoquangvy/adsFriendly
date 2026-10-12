(function () {
  var api = typeof browser !== "undefined" ? browser : chrome;
  var input = document.getElementById("package-file"),
    install = document.getElementById("install"),
    undo = document.getElementById("undo");
  var selected = null,
    reading = 0;
  function error(message) {
    var el = document.getElementById("error");
    el.textContent = message || "";
    el.hidden = !message;
  }
  function status(message) {
    document.getElementById("status").textContent = message;
  }
  async function send(message) {
    var result = await AFShared.callApi(api.runtime, "sendMessage", message);
    if (!result || result.error)
      throw new Error(
        result?.error || "The extension did not respond. Try again.",
      );
    return result;
  }
  async function refreshUndo() {
    var state = await send({ action: "get_import_state" });
    undo.hidden = !state.canUndo;
  }
  input.addEventListener("change", async function () {
    var generation = ++reading;
    selected = null;
    error("");
    document.getElementById("preview").hidden = true;
    var file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Package exceeds 2 MB.");
      var data = AFShared.normalizeSettingsPackage(
        JSON.parse(await file.text()),
      );
      if (generation !== reading) return;
      var summary = AFShared.summarizeSettingsPackage(data);
      selected = data;
      document.getElementById("package-name").textContent = summary.name;
      document.getElementById("summary").textContent =
        summary.whitelistCount +
        " allowed hosts · " +
        summary.blacklistCount +
        " blocked hosts · " +
        summary.ruleCount +
        " Hide rules · " +
        summary.exceptionCount +
        " Keep exceptions · " +
        summary.trustedPathCount +
        " trusted paths";
      document.getElementById("preview").hidden = false;
      status("Preview ready. Nothing has changed yet.");
    } catch (failure) {
      if (generation === reading) error(failure.message);
    }
  });
  install.addEventListener("click", async function () {
    if (!selected) return;
    install.disabled = true;
    undo.disabled = true;
    input.disabled = true;
    error("");
    status("Importing…");
    try {
      await send({ action: "import_settings_package", package: selected });
      status(
        "Imported. Reload existing Safari pages to apply all rules. You can undo this import below.",
      );
      await refreshUndo();
    } catch (failure) {
      error(failure.message);
      status("Import did not complete.");
    } finally {
      install.disabled = false;
      undo.disabled = false;
      input.disabled = false;
    }
  });
  undo.addEventListener("click", async function () {
    if (
      !confirm(
        "Restore the settings from before the last import? Choices made after importing will also be reverted.",
      )
    )
      return;
    undo.disabled = true;
    install.disabled = true;
    input.disabled = true;
    error("");
    try {
      await send({ action: "undo_settings_import" });
      status("Previous settings restored. Reload existing pages.");
      await refreshUndo();
    } catch (failure) {
      error(failure.message);
    } finally {
      undo.disabled = false;
      install.disabled = false;
      input.disabled = false;
    }
  });
  document
    .getElementById("diagnostics")
    .addEventListener("click", async function () {
      try {
        var data = await send({ action: "get_diagnostics" });
        document.getElementById("diagnostic-output").textContent =
          JSON.stringify(data.events, null, 2);
      } catch (failure) {
        error(failure.message);
      }
    });
  refreshUndo().catch((failure) => error(failure.message));
})();
