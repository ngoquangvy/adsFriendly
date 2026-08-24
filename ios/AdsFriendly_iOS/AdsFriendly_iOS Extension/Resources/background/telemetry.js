(function () {
  var bgApi = typeof browser !== "undefined" ? browser : chrome;
  var QUEUE_KEY = "afsTelemetryQueue";
  var ENABLED_KEY = "afsTelemetryEnabled";
  var ENDPOINT_KEY = "afsTelemetryEndpoint";
  var CLIENT_ID_KEY = "adsFriendlyClientId";
  var DEFAULT_ENDPOINT = "http://127.0.0.1:3000/api/ingest";
  var MAX_QUEUE = 250;

  function hostFromUrl(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (e) {
      return "unknown";
    }
  }

  function sanitizeUrl(url) {
    try {
      var parsed = new URL(url);
      parsed.username = "";
      parsed.password = "";
      parsed.hash = "";
      Array.prototype.slice
        .call(parsed.searchParams.keys())
        .forEach(function (key) {
          if (/token|key|auth|session|password|email|user|uid|id$/i.test(key)) {
            parsed.searchParams.set(key, "[redacted]");
          }
        });
      return parsed.href.slice(0, 2048);
    } catch (e) {
      return "";
    }
  }

  function sampleId() {
    return Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  function inferLabelStrength(labelSource) {
    if (/^user_|restore|undo|allow|block/i.test(labelSource || ""))
      return "strong";
    if (/heuristic|rule|model/i.test(labelSource || "")) return "weak";
    return "unknown";
  }

  function getClientId(callback) {
    getLocal([CLIENT_ID_KEY], function (result) {
      if (result[CLIENT_ID_KEY]) {
        callback(result[CLIENT_ID_KEY]);
        return;
      }
      var clientId = sampleId();
      var update = {};
      update[CLIENT_ID_KEY] = clientId;
      setLocal(update, function () {
        callback(clientId);
      });
    });
  }

  function buildEvent(raw, clientId) {
    raw = raw || {};
    var siteUrl = raw.siteUrl || raw.pageUrl || raw.sourceUrl || "";
    var targetUrl = raw.targetUrl || raw.url || "";
    var labelSource = raw.label_source || "heuristic_weak";
    return {
      schema_version: "dataset.v1",
      sample_id: raw.sample_id || sampleId(),
      unit: raw.unit || "navigation",
      label: raw.label || "unknown",
      label_source: labelSource,
      label_strength: raw.label_strength || inferLabelStrength(labelSource),
      ad_type: raw.ad_type || "popup",
      site: {
        hostname: hostFromUrl(siteUrl || targetUrl),
        url: sanitizeUrl(siteUrl),
      },
      timestamp: raw.timestamp || Date.now(),
      identity: {
        client_id: clientId,
        platform: "ios_safari_extension",
        app: "adsfriendly",
        schema: "identity.v1",
      },
      sync: {
        scope: raw.syncScope || "user",
        status: "queued",
        client_time: Date.now(),
      },
      context: {
        platform: "ios_safari_extension",
        surface: raw.surface || "unknown",
        source_host: hostFromUrl(raw.sourceUrl || siteUrl),
        target_host: hostFromUrl(targetUrl),
        same_site: !!raw.sameSite,
        user_intent: !!raw.userIntent,
        gesture_age_ms: raw.gestureAgeMs || null,
      },
      evidence: raw.evidence || {},
      feedback: raw.feedback || null,
      action: raw.action || null,
      outcome: raw.outcome || null,
      model: raw.model || {},
    };
  }

  function getLocal(keys, callback) {
    if (!bgApi.storage || !bgApi.storage.local) {
      callback({});
      return;
    }
    bgApi.storage.local.get(keys, callback);
  }

  function setLocal(values, callback) {
    if (!bgApi.storage || !bgApi.storage.local) {
      if (callback) callback();
      return;
    }
    bgApi.storage.local.set(values, callback);
  }

  function enqueue(event, callback) {
    getLocal([QUEUE_KEY], function (result) {
      var queue = result[QUEUE_KEY] || [];
      queue.push(event);
      if (queue.length > MAX_QUEUE)
        queue = queue.slice(queue.length - MAX_QUEUE);
      setLocal({ afsTelemetryQueue: queue }, function () {
        if (callback) callback(event);
        flushIfEnabled();
      });
    });
  }

  function flushIfEnabled() {
    getLocal([ENABLED_KEY, ENDPOINT_KEY, QUEUE_KEY], function (result) {
      if (result[ENABLED_KEY] !== true) return;
      var queue = result[QUEUE_KEY] || [];
      if (!queue.length) return;
      var endpoint = result[ENDPOINT_KEY] || DEFAULT_ENDPOINT;
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: queue.slice(0, 50) }),
      })
        .then(function (response) {
          if (!response.ok && response.status !== 207) return;
          setLocal({ afsTelemetryQueue: queue.slice(50) }, function () {
            flushIfEnabled();
          });
        })
        .catch(function () {});
    });
  }

  window.bgRecordAdEvent = function (raw, callback) {
    getClientId(function (clientId) {
      enqueue(buildEvent(raw, clientId), callback);
    });
  };

  window.bgFlushTelemetry = flushIfEnabled;

  console.log("[AdsFriendly BG] telemetry.js loaded.");
})();
