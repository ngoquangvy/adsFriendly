(function () {
  var SCHEMA = "adsfriendly.settings-package.v1";
  var STATE_KEY = "settingsPackageState";
  var BUNDLED_PATH = "packages/default-settings-package.json";
  var VALID_MODES = { safe: true, assist: true, auto: true };
  var VALID_LAYOUTS = { any: true, compact: true, wide: true };
  var DANGEROUS_SELECTORS = {
    "*": true, html: true, body: true, head: true, header: true,
    nav: true, main: true, form: true, div: true, span: true, p: true,
    a: true, li: true, ul: true, img: true, section: true, iframe: true,
    video: true
  };

  function clean(value, max) {
    return String(value || "").trim().slice(0, max);
  }

  function normalizeHost(value) {
    var raw = String(value || "").trim().replace(/^\|\|/, "").replace(/\^$/, "");
    if (!raw) return "";
    try {
      var hostname = new URL(raw.indexOf("://") >= 0 ? raw : "https://" + raw).hostname.toLowerCase();
      return /^[a-z0-9.-]+$/.test(hostname) ? hostname.slice(0, 253) : "";
    } catch (e) {
      return "";
    }
  }

  function normalizeApp(value) {
    value = value || {};
    return {
      enabled: value.enabled !== false,
      protectionMode: VALID_MODES[value.protectionMode] ? value.protectionMode : "safe",
      featureOverrides: value.featureOverrides && typeof value.featureOverrides === "object" && !Array.isArray(value.featureOverrides)
        ? value.featureOverrides : {}
    };
  }

  function normalizeDomains(values, blocked) {
    if (!Array.isArray(values)) return [];
    var seen = {};
    var result = [];
    values.forEach(function (value) {
      var host = normalizeHost(value);
      var entry = blocked && host ? "||" + host + "^" : host;
      if (entry && !seen[entry] && result.length < 2000) {
        seen[entry] = true;
        result.push(entry);
      }
    });
    return result;
  }

  function normalizeRule(rule) {
    var selector = clean(typeof rule === "string" ? rule : rule && rule.selector, 500);
    var lower = selector.toLowerCase();
    if (!selector || DANGEROUS_SELECTORS[lower] || lower.indexOf(":has(") >= 0) return null;
    if (typeof rule === "string") return selector;
    var result = {
      selector: selector,
      fingerprint: rule && rule.fingerprint && typeof rule.fingerprint === "object" ? rule.fingerprint : null,
      confidence: Math.max(0, Math.min(1, Number(rule && rule.confidence) || 0.8)),
      source: clean((rule && rule.source) || "package", 80),
      layout: VALID_LAYOUTS[rule && rule.layout] ? rule.layout : "any"
    };
    if (rule && rule.isCorrection === true) result.isCorrection = true;
    return result;
  }

  function normalizeRules(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    var output = {};
    Object.keys(value).slice(0, 5000).forEach(function (rawHost) {
      var host = normalizeHost(rawHost);
      if (!host || !Array.isArray(value[rawHost])) return;
      var seen = {};
      var rules = [];
      value[rawHost].slice(0, 250).forEach(function (rawRule) {
        var rule = normalizeRule(rawRule);
        var selector = typeof rule === "string" ? rule : rule && rule.selector;
        if (selector && !seen[selector]) {
          seen[selector] = true;
          rules.push(rule);
        }
      });
      if (rules.length) output[host] = rules;
    });
    return output;
  }

  function normalize(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Settings package must be an object.");
    if (input.schema_version !== SCHEMA) throw new Error("Unsupported settings package schema.");
    var metadata = input.metadata || {};
    var settings = input.settings || {};
    return {
      schema_version: SCHEMA,
      metadata: {
        id: clean(metadata.id || "package." + Date.now(), 120),
        name: clean(metadata.name || "AdsFriendly Settings", 120),
        author: clean(metadata.author || "Unknown", 120),
        version: clean(metadata.version || "1.0.0", 40),
        description: clean(metadata.description || "", 500),
        created_at: clean(metadata.created_at || new Date().toISOString(), 80)
      },
      settings: {
        app: normalizeApp(settings.app),
        whitelist: normalizeDomains(settings.whitelist, false),
        blacklist: normalizeDomains(settings.blacklist, true),
        custom_rules: normalizeRules(settings.custom_rules),
        trusted_paths: Array.isArray(settings.trusted_paths) ? settings.trusted_paths : []
      }
    };
  }

  function packageToStorage(input) {
    var pack = normalize(input);
    return {
      appSettings: pack.settings.app,
      isEnabled: pack.settings.app.enabled,
      friendlyMode: pack.settings.app.protectionMode === "safe",
      whitelist: pack.settings.whitelist,
      blacklist: pack.settings.blacklist,
      userCustomRules: pack.settings.custom_rules
    };
  }

  function install(input, storage, source, callback) {
    var pack;
    try { pack = normalize(input); } catch (error) { callback(error); return; }
    var updates = packageToStorage(pack);
    updates[STATE_KEY] = {
      schema_version: "adsfriendly.settings-package-state.v1",
      initialized: true,
      source: source || "imported",
      package: pack.metadata,
      installed_at: Date.now()
    };
    storage.set(updates, function () {
      var error = chrome.runtime && chrome.runtime.lastError;
      callback(error ? new Error(error.message) : null, pack);
    });
  }

  function loadBundled(callback) {
    fetch(chrome.runtime.getURL(BUNDLED_PATH))
      .then(function (response) {
        if (!response.ok) throw new Error("Could not load bundled settings (" + response.status + ").");
        return response.json();
      })
      .then(function (input) { callback(null, normalize(input)); })
      .catch(function (error) { callback(error); });
  }

  function initialize(storage, callback) {
    storage.get(null, function (snapshot) {
      snapshot = snapshot || {};
      if (snapshot[STATE_KEY] && snapshot[STATE_KEY].initialized) {
        callback(null, "already_initialized");
        return;
      }
      var meaningful = !!snapshot.appSettings || (snapshot.whitelist || []).length ||
        (snapshot.blacklist || []).length || Object.keys(snapshot.userCustomRules || {}).length;
      if (meaningful) {
        var state = {};
        state[STATE_KEY] = {
          schema_version: "adsfriendly.settings-package-state.v1",
          initialized: true,
          source: "existing_settings",
          package: null,
          installed_at: Date.now()
        };
        storage.set(state, function () { callback(null, "preserved_existing_settings"); });
        return;
      }
      loadBundled(function (error, pack) {
        if (error) { callback(error); return; }
        install(pack, storage, "bundled", function (installError) {
          callback(installError, "installed_bundled_package");
        });
      });
    });
  }

  function create(snapshot, metadata) {
    snapshot = snapshot || {};
    metadata = metadata || {};
    return normalize({
      schema_version: SCHEMA,
      metadata: {
        id: metadata.id || "ios." + Date.now(),
        name: metadata.name || "AdsFriendly iOS Settings",
        author: metadata.author || "AdsFriendly User",
        version: metadata.version || "1.0.0",
        description: metadata.description || "Exported AdsFriendly settings",
        created_at: new Date().toISOString()
      },
      settings: {
        app: snapshot.appSettings,
        whitelist: snapshot.whitelist,
        blacklist: snapshot.blacklist,
        custom_rules: snapshot.userCustomRules,
        trusted_paths: []
      }
    });
  }

  function summarize(input) {
    var pack = normalize(input);
    var hosts = Object.keys(pack.settings.custom_rules);
    var rules = hosts.reduce(function (count, host) { return count + pack.settings.custom_rules[host].length; }, 0);
    return { name: pack.metadata.name, version: pack.metadata.version, siteCount: hosts.length, ruleCount: rules };
  }

  window.AFSettingsPackage = {
    SCHEMA: SCHEMA,
    STATE_KEY: STATE_KEY,
    BUNDLED_PATH: BUNDLED_PATH,
    normalizeHost: normalizeHost,
    normalize: normalize,
    normalizeApp: normalizeApp,
    packageToStorage: packageToStorage,
    install: install,
    initialize: initialize,
    loadBundled: loadBundled,
    create: create,
    summarize: summarize
  };
})();
