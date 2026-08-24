import { LABELS, SAMPLE_UNITS } from "./label-schema.js";
export function createBaseSample(unit, context = {}) {
  return {
    sample_id: crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    unit,
    label: LABELS.UNKNOWN,
    site: { hostname: location.hostname, url: location.href.split("#")[0] },
    timestamp: Date.now(),
    context,
    evidence: {},
    action: null,
    outcome: null,
  };
}
export function createVideoSample(video, context = {}) {
  return createBaseSample(SAMPLE_UNITS.VIDEO_INSTANCE, {
    ...context,
    duration: Number.isFinite(video.duration) ? video.duration : null,
    currentTime: Number.isFinite(video.currentTime) ? video.currentTime : null,
    src_host: safeHost(video.currentSrc || video.src),
    muted: video.muted,
    autoplay: video.autoplay,
    visible: video.offsetWidth > 0 && video.offsetHeight > 0,
  });
}

export function createDomElementSample(element, context = {}) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return createBaseSample(SAMPLE_UNITS.DOM_ELEMENT, {
    ...context,
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    className: typeof element.className === "string" ? element.className : null,
    src_host: safeHost(element.currentSrc || element.src),
    href_host: safeHost(element.href),
    visible:
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden",
    rect: {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    position: style.position,
    zIndex: style.zIndex,
  });
}

export function createNavigationSample(targetUrl, context = {}) {
  return createBaseSample(SAMPLE_UNITS.NAVIGATION, {
    ...context,
    target_host: safeHost(targetUrl),
  });
}

function safeHost(url) {
  try {
    return new URL(url, location.href).hostname;
  } catch {
    return null;
  }
}
