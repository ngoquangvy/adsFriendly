(function() {
  function safeHost(url) {
    try {
      return new URL(url, window.location.href).hostname.toLowerCase();
    } catch(e) {
      return "unknown";
    }
  }

  function elementEvidence(el) {
    if (!el || !el.getBoundingClientRect) return {};
    var rect = el.getBoundingClientRect();
    var style = window.getComputedStyle(el);
    return {
      tag: (el.tagName || "").toLowerCase(),
      class_token_count: String(el.className || "").split(/\s+/).filter(Boolean).length,
      id_present: !!el.id,
      target: el.getAttribute ? (el.getAttribute("target") || "") : "",
      visible: !(style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity || "1") <= 0.1),
      position: style.position,
      opacity: parseFloat(style.opacity || "1"),
      area_ratio: window.innerWidth && window.innerHeight
        ? Math.min(1, (rect.width * rect.height) / (window.innerWidth * window.innerHeight))
        : 0
    };
  }

  window.afsRecordTelemetry = function(data) {
    data = data || {};
    try {
      api.runtime.sendMessage({
        action: "log_ad_event",
        event: {
          unit: data.unit || "navigation",
          label: data.label || "unknown",
          label_source: data.label_source || "heuristic_weak",
          ad_type: data.ad_type || "popup",
          surface: data.surface || "content_script",
          pageUrl: window.location.href,
          sourceUrl: window.location.href,
          targetUrl: data.targetUrl || data.url || "",
          sameSite: data.targetUrl ? areSameSite(window.location.href, data.targetUrl) : false,
          userIntent: !!data.userIntent,
          evidence: Object.assign({
            reason: data.reason || "unknown",
            page_host: safeHost(window.location.href),
            target_host: safeHost(data.targetUrl || data.url || "")
          }, data.element ? { element: elementEvidence(data.element) } : {}, data.evidence || {}),
          action: data.action || null,
          outcome: data.outcome || null,
          model: data.model || {}
        }
      });
    } catch(e) {}
  };
})();
